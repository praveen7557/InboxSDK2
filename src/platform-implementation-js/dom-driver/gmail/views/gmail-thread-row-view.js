var _ = require('lodash');
var assert = require('assert');
const Bacon = require('baconjs');
const Kefir = require('kefir');
const asap = require('asap');


const assertInterface = require('../../../lib/assert-interface');
var makeMutationObserverChunkedStream = require('../../../lib/dom/make-mutation-observer-chunked-stream');
var baconCast = require('bacon-cast');
const kefirCast = require('kefir-cast');
var ThreadRowViewDriver = require('../../../driver-interfaces/thread-row-view-driver');
import kefirDelayAsap from '../../../lib/kefir-delay-asap';

var GmailDropdownView = require('../widgets/gmail-dropdown-view');
var DropdownView = require('../../../widgets/buttons/dropdown-view');
var GmailLabelView = require('../widgets/gmail-label-view');

var updateIcon = require('../lib/update-icon/update-icon');

const cachedModificationsByRow = new WeakMap();

function focusAndNoPropagation(event) {
  this.focus();
  event.stopImmediatePropagation();
}

function starGroupEventInterceptor(event) {
  const isOnStar = this.firstElementChild.contains(event.target);
  const isOnSDKButton = !isOnStar && this !== event.target;
  if (!isOnStar) {
    event.stopImmediatePropagation();
    if (!isOnSDKButton || event.type == 'mouseover') {
      const newEvent = document.createEvent('MouseEvents');
      newEvent.initMouseEvent(
        event.type, event.bubbles, event.cancelable, event.view,
        event.detail, event.screenX, event.screenY, event.clientX, event.clientY,
        event.ctrlKey, event.altKey, event.shiftKey, event.metaKey,
        event.button, event.relatedTarget
      );
      this.parentElement.dispatchEvent(newEvent);
    }
  }
}

// Change a color very slightly to force a re-render
function tweakColor(color) {
  // example:
  // "rgba(255, 255, 255, 0.9)" -> "rgba(254, 254, 254, 0.9)"
  if (typeof color === 'string') {
    return color.replace(/(\d+),/g, (full, num) => (num^1)+',');
  }
  return color;
}

var GmailThreadRowView = function(element, rowListViewDriver) {
  assert(element.hasAttribute('id'), 'check element is main thread row');

  const isVertical = _.intersection(_.toArray(element.classList), ['zA','apv']).length === 2;
  if (isVertical) {
    const threadRow3 = element.nextElementSibling.nextElementSibling;
    const has3Rows = (threadRow3 && threadRow3.classList.contains('apw'));
    this._elements = has3Rows ?
      [element, element.nextElementSibling, element.nextElementSibling.nextElementSibling] :
      [element, element.nextElementSibling];
  } else {
    this._elements = [element];
  }

  this._modifications = cachedModificationsByRow.get(this._elements[0]);
  if (!this._modifications) {
    this._alreadyHadModifications = false;
    this._modifications = {
      label: {unclaimed: [], claimed: []},
      button: {unclaimed: [], claimed: []},
      image: {unclaimed: [], claimed: []},

      replacedDate: {destroy: null, claimed: false}
    };
    cachedModificationsByRow.set(this._elements[0], this._modifications);
  } else {
    this._alreadyHadModifications = true;
  }

  this._rowListViewDriver = rowListViewDriver;
  this._pageCommunicator = null; // supplied by GmailDriver later
  this._userView = null; // supplied by ThreadRowView
  this._cachedThreadID = null; // set in getter


  this._eventStream = new Kefir.Bus();
  this._stopper = new Kefir.Emitter();

  this._imageFixer = new Kefir.Emitter(); // emit into this to queue an image fixer run
  this._imageFixerTask = this._imageFixer
    .bufferBy(this._imageFixer.flatMap(x => kefirDelayAsap()))
    .map(x => null)
    .takeUntilBy(this._stopper);

  this._subscribeTextFixer = _.once(() => {
    // Work around the text-corruption issue on Chrome on retina displays that
    // happens when images are added to the row.
    this._imageFixerTask.onValue(() => {
      const tr = this._elements[0];
      const computedBgColor = window.getComputedStyle(tr).backgroundColor;
      tr.style.backgroundColor = tweakColor(computedBgColor);
      setTimeout(() => {
        tr.style.backgroundColor = '';
      }, 0);
    });
  });


  // Stream that emits an event after whenever Gmail replaces the ThreadRow DOM
  // nodes. One time this happens is when you have a new email in your inbox,
  // you read the email, return to the inbox, get another email, and then the
  // first email becomes re-rendered.
  // Important: This stream is only listened on if some modifier method
  // (like addLabel) is called. If none of those methods are called, then the
  // stream is not listened on and no MutationObserver ever gets made, saving
  // us a little bit of work.
  const watchElement = this._elements.length === 1 ?
    this._elements[0] : this._elements[0].children[2];

    this._refresher = kefirCast(Kefir, makeMutationObserverChunkedStream(watchElement, {
      childList: true
    })).mapTo(null).takeUntilBy(this._stopper).toProperty(null);

  if(isVertical){
    this._subjectRefresher = Kefir.constant(null);
  }
  else{
    const subjectElement = watchElement.querySelector('.y6');
    this._subjectRefresher = kefirCast(
                              Kefir,
                              makeMutationObserverChunkedStream(subjectElement, {
                                childList: true
                              })
                            )
                            .merge(
                              kefirCast(
                                Kefir,
                                makeMutationObserverChunkedStream(watchElement, {
                                  attributes: true, attributeFilter: ['class']
                                })
                              )
                            )
                            .mapTo(null).takeUntilBy(this._stopper).toProperty(null);
  }

  this.getCounts = _.once(function() {
    const thing = this._elements[0].querySelector('td div.yW');
    const [preDrafts, drafts] = thing.innerHTML.split(/<font color=[^>]+>[^>]+<\/font>/);

    const preDraftsWithoutNames = preDrafts.replace(/<span\b[^>]*>.*?<\/span>/g, '');

    const messageCountMatch = preDraftsWithoutNames.match(/\((\d+)\)/);
    const messageCount = messageCountMatch ? +messageCountMatch[1] : (preDrafts ? 1 : 0);

    const draftCountMatch = drafts && drafts.match(/\((\d+)\)/);
    const draftCount = draftCountMatch ? +draftCountMatch[1] : (drafts != null ? 1 : 0);
    return {messageCount, draftCount};
  });
};

/* Members:
{name: '_elements', destroy: false},
{name: '_modifications', destroy: false},
{name: '_pageCommunicator', destroy: false},
{name: '_userView', destroy: false},
{name: '_cachedThreadID', destroy: false},
{name: '_rowListViewDriver', destroy: false},
{name: '_eventStream', destroy: true, get: true, destroyFunction: 'end'},
{name: '_stopper', destroy: true, destroyFunction: 'push'},
{name: '_refresher', destroy: false}
*/

_.extend(GmailThreadRowView.prototype, {

  destroy: function() {
    if(!this._elements){
      return;
    }

    this._modifications.label.unclaimed = this._modifications.label.claimed
      .concat(this._modifications.label.unclaimed);
    this._modifications.label.claimed.length = 0;

    this._modifications.button.unclaimed = this._modifications.button.claimed
      .concat(this._modifications.button.unclaimed);
    this._modifications.button.claimed.length = 0;

    this._modifications.image.unclaimed = this._modifications.image.claimed
      .concat(this._modifications.image.unclaimed);
    this._modifications.image.claimed.length = 0;

    this._modifications.replacedDate.claimed = false;

    _.chain(this._elements)
      .map((el) => el.getElementsByClassName('inboxsdk__thread_row_addition'))
      .map(_.toArray)
      .flatten()
      .value().forEach((el) => {
        el.remove();
      });

    this._eventStream.end();
    this._stopper.emit(null);
    this._elements = null;
  },

  getEventStream() {
    return this._eventStream;
  },

  // Called by GmailDriver
  setPageCommunicator: function(pageCommunicator) {
    this._pageCommunicator = pageCommunicator;
  },

  _removeUnclaimedModifications() {
    for (let mod of this._modifications.label.unclaimed) {
      //console.log('removing unclaimed label mod', mod);
      mod.remove();
    }
    this._modifications.label.unclaimed.length = 0;
    for (let mod of this._modifications.button.unclaimed) {
      //console.log('removing unclaimed button mod', mod);
      mod.remove();
    }
    this._modifications.button.unclaimed.length = 0;
    for (let mod of this._modifications.image.unclaimed) {
      //console.log('removing unclaimed image mod', mod);
      mod.remove();
    }
    this._modifications.image.unclaimed.length = 0;

    if (this._modifications.replacedDate.destroy &&
      !this._modifications.replacedDate.claimed
    ) {
      //console.log('removing unclaimed date replacement');
      this._modifications.replacedDate.destroy();
      this._modifications.replacedDate.destroy = null;
    }
  },

  // Returns a Kefir stream that emits this object once this object is ready for the
  // user. It should almost always synchronously ready immediately, but there's
  // a few cases such as with multiple inbox that it needs a moment.
  waitForReady: function() {
    const time = [0,10,100];
    const step = () => {
      if (this._threadIdReady()) {
        asap(() => {
          if (this._elements)
            this._removeUnclaimedModifications();
        });
        return Kefir.constant(this);
      } else {
        const stepTime = time.shift();
        if (stepTime == undefined) {
          console.log('Should not happen: ThreadRowViewDriver never became ready', this);
          return Kefir.never();
        } else {
          return Kefir.later(stepTime).flatMap(step);
        }
      }
    };

    // Performance hack: If the row already has old modifications on it, wait
    // a moment before we re-emit the thread row and process our new
    // modifications.
    const stepToUse = this._alreadyHadModifications ?
      () => Kefir.later(2).flatMap(step) : step;

    return stepToUse().takeUntilBy(this._stopper);

  },

  setUserView: function(userView) {
    this._userView = userView;
  },

  _expandColumn: function(colSelector, width) {
    this._rowListViewDriver.expandColumn(colSelector, width);
  },

  addLabel: function(label) {
    if (!this._elements) {
      console.warn('addLabel called on destroyed thread row');
      return;
    }
    const prop = kefirCast(Kefir, label).takeUntilBy(this._stopper).toProperty();
    var labelMod = null;

    prop.combine(this._refresher, _.identity).takeUntilBy(this._stopper).onValue(labelDescriptor => {
      if(!labelDescriptor){
        if (labelMod) {
          labelMod.remove();
          this._modifications.label.claimed.splice(
            this._modifications.label.claimed.indexOf(labelMod), 1);
          labelMod = null;
        }
      } else {
        if (!labelMod) {
          labelMod = this._modifications.label.unclaimed.shift();
          if (!labelMod) {
            const gmailLabelView = new GmailLabelView({
              classes: ['inboxsdk__thread_row_label']
            });
            const el = gmailLabelView.getElement();
            labelMod = {
              gmailLabelView,
              remove: el.remove.bind(el)
            };
          }
          this._modifications.label.claimed.push(labelMod);
        }

        labelMod.gmailLabelView.updateLabelDescriptor(labelDescriptor);

        const labelParentDiv = this._getLabelParent();
        if (!_.contains(labelParentDiv.children, labelMod.gmailLabelView.getElement())) {
          labelParentDiv.insertBefore(
            labelMod.gmailLabelView.getElement(), labelParentDiv.lastChild);
        }
        this._imageFixer.emit();
      }
    });
  },

  addImage: function(inIconDescriptor){
    if (!this._elements) {
      console.warn('addImage called on destroyed thread row');
      return;
    }
    const prop = kefirCast(Kefir, inIconDescriptor)
                  .toProperty()
                  .combine(this._refresher, _.identity)
                  .combine(this._subjectRefresher, _.identity)
                  .takeUntilBy(this._stopper);

    let imageMod = null;

    prop.onValue(iconDescriptor => {
      if (!iconDescriptor) {
        if (imageMod) {
          imageMod.remove();
          this._modifications.image.claimed.splice(
            this._modifications.image.claimed.indexOf(imageMod), 1);
          imageMod = null;
        }
      } else {
        if (!imageMod) {
          imageMod = this._modifications.image.unclaimed.shift();
          if (!imageMod) {

            imageMod = {
              iconSettings: {},
              iconWrapper: document.createElement('div'),
              remove() {
                imageMod.iconWrapper.remove();
              }
            };
            imageMod.iconWrapper.className = 'inboxsdk__thread_row_icon_wrapper';
          }
          this._modifications.image.claimed.push(imageMod);
        }
        const {iconSettings, iconWrapper} = imageMod;

        updateIcon(iconSettings, iconWrapper, false, iconDescriptor.imageClass, iconDescriptor.imageUrl);

        const containerRow = this._elements.length === 3 ? this._elements[2] : this._elements[0];
        containerRow.classList.add('inboxsdk__thread_row_image_added');

        if(iconDescriptor.tooltip){
          iconSettings.iconElement.setAttribute('data-tooltip', iconDescriptor.tooltip);
        }

        if(!this._elements[0].contains(iconWrapper)) {
          const insertionPoint = this._elements.length > 1 ?
                                this._getLabelParent() :
                                this._getLabelParent().querySelector('.y6');

          insertionPoint.insertBefore(iconWrapper, insertionPoint.firstElementChild);
        }
        this._imageFixer.emit();
      }
    });

    this._imageFixerTask.onValue(() => {
      const el = imageMod && imageMod.iconWrapper && imageMod.iconWrapper.firstElementChild;
      if (el) {
        // Make the image reposition itself horizontally.
        el.style.display = (el.style.display === 'block') ? 'inline-block' : 'block';
      }
    });
    this._subscribeTextFixer();
  },

  addButton: function(buttonDescriptor) {
    if (!this._elements) {
      console.warn('addButton called on destroyed thread row');
      return;
    }
    if (this._elements.length != 1) return; // buttons not supported in vertical preview pane

    var activeDropdown = null;
    var buttonMod = null;


    var prop = kefirCast(Kefir, buttonDescriptor).toProperty().takeUntilBy(this._stopper);

    prop.mapEnd(() => null).onValue(buttonDescriptor => {
      if (!buttonDescriptor) {
        if (activeDropdown) {
          activeDropdown.close();
          activeDropdown = null;
        }
        if (buttonMod && buttonMod.buttonSpan) {
          buttonMod.buttonSpan.onclick = null;
        }
      }
    });

    prop.combine(this._refresher, _.identity).onValue(buttonDescriptor => {
      if (!buttonDescriptor) {
        if (buttonMod) {
          buttonMod.remove();
          this._modifications.button.claimed.splice(
            this._modifications.button.claimed.indexOf(buttonMod), 1);
          buttonMod = null;
        }
      } else {
        // compat workaround
        if (buttonDescriptor.className) {
          buttonDescriptor.iconClass = buttonDescriptor.className;
          delete buttonDescriptor.className;
        }

        // could also be trash icon
        const starGroup = this._elements[0].querySelector('td.apU.xY, td.aqM.xY');

        let buttonSpan, iconSettings;
        if (!buttonMod) {
          buttonMod = this._modifications.button.unclaimed.shift();
          if (!buttonMod) {
            buttonSpan = document.createElement('span');
            buttonSpan.className = 'inboxsdk__thread_row_button';
            buttonSpan.setAttribute('tabindex', "-1");
            buttonSpan.onmousedown = focusAndNoPropagation;

            // Don't let the whole column count as the star for click and mouse over purposes.
            // Click events that aren't directly on the star should be stopped.
            // Mouseover events that aren't directly on the star should be stopped and
            // re-emitted from the thread row, so the thread row still has the mouseover
            // appearance.
            // Click events that are on one of our buttons should be stopped. Click events
            // that aren't on the star button or our buttons should be re-emitted from the
            // thread row so it counts as clicking on the thread.
            starGroup.onmouseover = starGroup.onclick = starGroupEventInterceptor;

            iconSettings = {
              iconUrl: null,
              iconClass: null,
              iconElement: null,
              iconImgElement: null
            };

            buttonMod = {
              buttonSpan,
              iconSettings,
              remove: buttonSpan.remove.bind(buttonSpan)
            };
          }
          this._modifications.button.claimed.push(buttonMod);
        }

        buttonSpan = buttonMod.buttonSpan;
        iconSettings = buttonMod.iconSettings;

        if(buttonDescriptor.onClick){
          buttonSpan.onclick = (event) => {
            const appEvent = {
              threadRowView: this._userView
            };
            if (buttonDescriptor.hasDropdown) {
              if (activeDropdown) {
                this._elements[0].classList.remove('inboxsdk__dropdown_active');
                activeDropdown.close();
                activeDropdown = null;
                return;
              } else {
                this._elements[0].classList.add('inboxsdk__dropdown_active');
                appEvent.dropdown = activeDropdown = new DropdownView(new GmailDropdownView(), buttonSpan, null);
                appEvent.dropdown.on('destroy', function(){
                  setTimeout(function(){
                    activeDropdown = null;
                  }, 1);
                });
              }
            }
            buttonDescriptor.onClick.call(null, appEvent);
          };
        }

        updateIcon(iconSettings, buttonSpan, false, buttonDescriptor.iconClass, buttonDescriptor.iconUrl);
        if (!_.contains(starGroup.children, buttonSpan)) {
          starGroup.appendChild(buttonSpan);
          this._expandColumn('col.y5', 26*starGroup.children.length);
        }
        this._imageFixer.emit();
      }
    });
  },

  addAttachmentIcon: function(opts) {
    if (!this._elements) {
      console.warn('addAttachmentIcon called on destroyed thread row');
      return;
    }
    const getImgElement = _.once(() => {
      const img = document.createElement('img');
      img.src = 'images/cleardot.gif';
      return img;
    });
    var added = false;
    var currentIconUrl;

    var prop = kefirCast(Kefir, opts).toProperty();
    prop.combine(this._refresher, _.identity).takeUntilBy(this._stopper).onValue(opts => {
      if (!opts) {
        if (added) {
          getImgElement().remove();
          added = false;
        }
      } else {
        const img = getImgElement();
        if(opts.tooltip){
          img.setAttribute('data-tooltip', opts.tooltip);
        }
        else{
          img.removeAttribute('data-tooltip');
        }

        img.className =
          'inboxsdk__thread_row_addition inboxsdk__thread_row_attachment_icon ' +
          (opts.iconClass || '');
        if (currentIconUrl != opts.iconUrl) {
          img.style.background = opts.iconUrl ? "url("+opts.iconUrl+") no-repeat 0 0" : '';
          currentIconUrl = opts.iconUrl;
        }

        var attachmentDiv = this._elements[0].querySelector('td.yf.xY');
        if (!attachmentDiv.contains(img)) {
          attachmentDiv.appendChild(img);
          added = true;
          this._expandColumn('col.yg', attachmentDiv.children.length*16);
          if (this._elements.length > 1) {
            this._fixDateColumnWidth();
          }
        }
      }
    });
  },

  _fixDateColumnWidth: function() {
    asap(() => {
      if (!this._elements) return;

      const dateContainer = this._elements[0].querySelector('td.xW, td.yf > div.apm');
      if (!dateContainer) return;
      const visibleDateSpan = dateContainer.querySelector('.inboxsdk__thread_row_custom_date') ||
        dateContainer.firstElementChild;

      // Attachment icons are only in the date column in vertical preivew pane.
      const dateColumnAttachmentIconCount = this._elements[0].querySelectorAll('td.yf > img').length;
      this._expandColumn('col.xX',
        visibleDateSpan.offsetWidth + 8 + 6 + dateColumnAttachmentIconCount*16);
    });
  },

  replaceDate: function(opts) {
    if (!this._elements) {
      console.warn('replaceDate called on destroyed thread row');
      return;
    }
    const prop = kefirCast(Kefir, opts).toProperty();
    prop.combine(this._refresher, _.identity).takeUntilBy(this._stopper).onValue(opts => {
      const dateContainer = this._elements[0].querySelector('td.xW, td.yf > div.apm');
      const originalDateSpan = dateContainer.firstElementChild;
      var customDateSpan = originalDateSpan.nextElementSibling;
      if (!customDateSpan) {
        customDateSpan = document.createElement('span');
        customDateSpan.className = 'inboxsdk__thread_row_custom_date';
        dateContainer.appendChild(customDateSpan);

        this._modifications.replacedDate.destroy = () => {
          customDateSpan.remove();
          originalDateSpan.style.display = 'inline';
        };
      }

      if (!opts) {
        this._modifications.replacedDate.claimed = false;
        customDateSpan.style.display = 'none';
        originalDateSpan.style.display = 'inline';
      } else {
        this._modifications.replacedDate.claimed = true;
        customDateSpan.textContent = opts.text;
        if (opts.tooltip) {
          customDateSpan.setAttribute('data-tooltip', opts.tooltip);
          customDateSpan.setAttribute('aria-label', opts.tooltip);
        } else {
          customDateSpan.removeAttribute('data-tooltip');
          customDateSpan.removeAttribute('aria-label');
        }
        customDateSpan.style.color = opts.textColor || '';

        customDateSpan.style.display = 'inline';
        originalDateSpan.style.display = 'none';

        this._fixDateColumnWidth();
      }
    });
  },

  getSubject: function() {
    if (this._elements.length > 1) {
      return this._elements[1].querySelector('div.xS div.xT div.y6 > span[id]').textContent;
    } else {
      return this._elements[0].querySelector('td.a4W div.xS div.xT div.y6 > span[id]').textContent;
    }
  },

  getDateString: function() {
    return this._elements[0].querySelector('td.xW > span, td.yf.apt > div.apm > span').title;
  },

  _threadIdReady: function() {
    return !!this.getThreadID();
  },

  getThreadID: function() {
    if (this._cachedThreadID) {
      return this._cachedThreadID;
    }
    const threadID = this._pageCommunicator.getThreadIdForThreadRow(this._elements[0]);
    if (threadID) {
      this._cachedThreadID = threadID;
    }
    return threadID;
  },

  getVisibleDraftCount: function() {
    return this.getCounts().draftCount;
  },

  getVisibleMessageCount: function() {
    return this.getCounts().messageCount;
  },

  getContacts: function(){
    const senderSpans = this._elements[0].querySelectorAll('[email]');

    return _.chain(senderSpans)
            .map((span) => ({
              emailAddress: span.getAttribute('email'),
              name: span.getAttribute('name')
            }))
            .uniq((contact) => contact.emailAddress)
            .value();
  },

  isSelected: function(){
    return !!this._elements[0].querySelector('div[role=checkbox][aria-checked=true]');
  },

  _getLabelParent: function(){
    return this._elements.length > 1 ?
            this._elements[ this._elements.length === 2 ? 0 : 2 ].querySelector('div.apu') :
            this._elements[0].querySelector('td.a4W div.xS div.xT');
  }

});

assertInterface(GmailThreadRowView.prototype, ThreadRowViewDriver);

module.exports = GmailThreadRowView;
