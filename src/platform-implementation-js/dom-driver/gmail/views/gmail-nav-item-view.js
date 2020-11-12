/* @flow */

import autoHtml from 'auto-html';
import Kefir from 'kefir';
import kefirBus from 'kefir-bus';
import type { Bus } from 'kefir-bus';

import GmailElementGetter from '../gmail-element-getter';

import getInsertBeforeElement from '../../../lib/dom/get-insert-before-element';
import querySelector from '../../../lib/dom/querySelectorOrFail';
import makeMutationObserverChunkedStream from '../../../lib/dom/make-mutation-observer-chunked-stream';

import ButtonView from '../widgets/buttons/button-view';
import MoreDropdownButtonView from '../widgets/buttons/more-dropdown-button-view';
import LabelDropdownButtonView from '../widgets/buttons/label-dropdown-button-view';
import CreateAccessoryButtonView from '../widgets/buttons/create-accessory-button-view';
import GmailDropdownView from '../widgets/gmail-dropdown-view';

import DropdownButtonViewController from '../../../widgets/buttons/dropdown-button-view-controller';
import BasicButtonViewController from '../../../widgets/buttons/basic-button-view-controller';

import updateIcon from '../../../driver-common/update-icon';
import renderCustomIcon from '../../../driver-common/render-custom-icon';

import NAV_ITEM_TYPES from '../../../constants/nav-item-types';

import type GmailDriver from '../gmail-driver';

let NUMBER_OF_GMAIL_NAV_ITEM_VIEWS_CREATED = 0;

const GMAIL_V1_LEFT_INDENTATION_PADDING = 14;
const GMAIL_V2_LEFT_INDENTATION_PADDING = 12;

export default class GmailNavItemView {
  _accessory: ?Object = null;
  _accessoryCreated: boolean = false;
  _accessoryViewController: ?Object = null;
  _driver: GmailDriver;
  _element: HTMLElement;
  _eventStream: Bus<any>;
  _expandoElement: ?HTMLElement = null;
  _iconSettings: Object = {};
  _isActive: boolean = false;
  _isCollapsed: boolean = false;
  _itemContainerElement: ?HTMLElement = null;
  _level: number;
  _name: string = '';
  _navItemDescriptor: Object;
  _navItemNumber: number;
  _orderGroup: number | string;
  _orderHint: any;
  _type: ?string = null;

  constructor(driver: GmailDriver, orderGroup: number | string, level: number) {
    this._driver = driver;
    this._eventStream = kefirBus();
    this._level = level || 0;
    this._navItemNumber = ++NUMBER_OF_GMAIL_NAV_ITEM_VIEWS_CREATED;
    this._orderGroup = orderGroup;

    this._setupElement();
  }

  addNavItem(
    orderGroup: number | string,
    navItemDescriptor: Object
  ): GmailNavItemView {
    const nestedNavItemLevel =
      this._type === NAV_ITEM_TYPES.GROUPER ? this._level : this._level + 1;
    const gmailNavItemView = new GmailNavItemView(
      this._driver,
      orderGroup,
      nestedNavItemLevel
    );

    gmailNavItemView
      .getEventStream()
      .filter(event => event.eventName === 'orderChanged')
      .onValue(() => this._addNavItemElement(gmailNavItemView));

    gmailNavItemView.setNavItemDescriptor(navItemDescriptor);

    return gmailNavItemView;
  }

  destroy() {
    this._element.remove();

    if (this._accessoryViewController) this._accessoryViewController.destroy();
    if (this._eventStream) this._eventStream.end();
    if (this._expandoElement) this._expandoElement.remove();
    if (this._itemContainerElement) this._itemContainerElement.remove();
  }

  getElement(): HTMLElement {
    return this._element;
  }

  getEventStream(): Kefir.Observable<Object> {
    return this._eventStream;
  }

  getName(): string {
    return this._name;
  }

  getNavItemDescriptor(): Object {
    return this._navItemDescriptor;
  }

  getOrderGroup(): number | string {
    return this._orderGroup;
  }

  getOrderHint(): ?number {
    return this._orderHint;
  }

  isCollapsed(): boolean {
    return this._isCollapsed;
  }

  remove() {
    this.destroy();
  }

  setActive(value: boolean) {
    if (
      !this._element ||
      this._type === NAV_ITEM_TYPES.LINK ||
      this._type === NAV_ITEM_TYPES.MANAGE ||
      this._isActive === value
    ) {
      return;
    }

    const toElement = querySelector(this._element, '.TO');

    if (value) {
      this._element.classList.add('ain');
      toElement.classList.add('nZ');
      toElement.classList.add('aiq');
    } else {
      this._element.classList.remove('ain');
      toElement.classList.remove('nZ');
      toElement.classList.remove('aiq');
    }

    this._setHeights();
    this._isActive = value;
  }

  setCollapsed(value: boolean) {
    this._isCollapsed = value;

    if (!this._isCollapsible()) {
      return;
    }

    if (value) {
      this._collapse();
    } else {
      this._expand();
    }
  }

  setNavItemDescriptor(
    navItemDescriptorPropertyStream: Kefir.Observable<Object>
  ) {
    navItemDescriptorPropertyStream
      .takeUntilBy(this._eventStream.filter(() => false).beforeEnd(() => null))
      .onValue(x => this._updateValues(x));
  }

  toggleCollapse() {
    this._toggleCollapse();
  }

  _addNavItemElement(gmailNavItemView: GmailNavItemView) {
    const itemContainerElement = this._getItemContainerElement();

    const insertBeforeElement = getInsertBeforeElement(
      gmailNavItemView.getElement(),
      itemContainerElement.children,
      ['data-group-order-hint', 'data-order-hint', 'data-insertion-order-hint']
    );
    itemContainerElement.insertBefore(
      gmailNavItemView.getElement(),
      insertBeforeElement
    );

    const indentationFactor =
      this._type === NAV_ITEM_TYPES.GROUPER ? this._level - 1 : this._level;

    const element = gmailNavItemView.getElement();

    querySelector(element, '.TN').style.marginLeft =
      getLeftIndentationPaddingValue(this._driver) * indentationFactor + 'px';

    this._setHeights();
  }

  _collapse() {
    const expandoElement = this._expandoElement;
    if (expandoElement) {
      expandoElement.classList.remove('aih');
      expandoElement.classList.add('aii');
    } else if (this._type === NAV_ITEM_TYPES.GROUPER) {
      const navItemElement = this._element.firstElementChild;
      if (navItemElement) navItemElement.classList.remove('air');
    }

    if (this._itemContainerElement)
      this._itemContainerElement.style.display = 'none';

    this._isCollapsed = true;

    this._setHeights();

    this._eventStream.emit({
      eventName: 'collapsed'
    });
  }

  _createAccessory(accessoryDescriptor: Object) {
    switch (accessoryDescriptor.type) {
      case 'CREATE':
        this._createCreateAccessory(accessoryDescriptor);
        break;
      case 'ICON_BUTTON':
        this._createIconButtonAccessory(accessoryDescriptor);
        break;
      case 'DROPDOWN_BUTTON':
        this._createDropdownButtonAccessory(accessoryDescriptor);
        break;
      case 'SETTINGS_BUTTON':
        this._createSettingsButtonAccessory(accessoryDescriptor);
        break;
    }

    this._accessoryCreated = true;
  }

  _createCreateAccessory(accessoryDescriptor: Object) {
    this._createPlusButtonAccessory(accessoryDescriptor);
  }

  _createDropdownButtonAccessory(accessoryDescriptor: Object) {
    const buttonOptions = { ...accessoryDescriptor };
    buttonOptions.buttonView = new MoreDropdownButtonView(buttonOptions);
    buttonOptions.dropdownViewDriverClass = GmailDropdownView;
    buttonOptions.dropdownPositionOptions = {
      position: 'bottom',
      hAlign: 'left',
      vAlign: 'top'
    };

    const container = GmailElementGetter.getLeftNavContainerElement();
    if (!container) throw new Error('leftNavContainer not found');

    buttonOptions.dropdownShowFunction = event => {
      // bhZ is the class to indicate the left nav is collapsible mode
      // bym is class to show expanded when the left nav is collapsible
      if (container.classList.contains('bhZ')) {
        const stopper = Kefir.fromEvents(event.dropdown, 'destroy');

        // monitor class on the container and keep re-adding bym until dropdown closes
        makeMutationObserverChunkedStream(container, {
          attributes: true,
          attributeFilter: ['class']
        })
          .takeUntilBy(stopper)
          .toProperty(() => null)
          .onValue(() => {
            if (!container.classList.contains('bym'))
              container.classList.add('bym');
          });

        stopper.onValue(() => {
          container.classList.remove('bym');
        });
      }

      buttonOptions.onClick(event);

      event.dropdown.on('destroy', () => {
        buttonOptions.buttonView.deactivate();
      });
    };

    const accessoryViewController = new DropdownButtonViewController(
      buttonOptions
    );
    this._accessoryViewController = accessoryViewController;

    const innerElement = querySelector(this._element, '.TO');
    innerElement.addEventListener('mouseenter', () =>
      innerElement.classList.add('inboxsdk__navItem_hover')
    );
    innerElement.addEventListener('mouseleave', () =>
      innerElement.classList.remove('inboxsdk__navItem_hover')
    );

    const insertionPoint = querySelector(this._element, '.TN');

    insertionPoint.appendChild(buttonOptions.buttonView.getElement());

    this._setupContextClickHandler(accessoryViewController);
  }

  _createExpando() {
    if (this._type === NAV_ITEM_TYPES.GROUPER) {
      return;
    }

    const expandoElement = (this._expandoElement = document.createElement(
      'div'
    ));

    expandoElement.setAttribute('class', 'TH aih J-J5-Ji inboxsdk__expando');
    expandoElement.setAttribute('role', 'link');
    expandoElement.title = `Expand ${this._name || ''}`;

    expandoElement.addEventListener('click', (e: MouseEvent) => {
      this._toggleCollapse();
      e.stopPropagation();
    });

    const insertionPoint = this._element.querySelector('.TN.aik');

    if (insertionPoint)
      (insertionPoint: any).insertAdjacentElement('afterbegin', expandoElement);

    if (this._isCollapsed) {
      this._collapse();
    } else {
      this._expand();
    }
  }

  _createIconButtonAccessory(accessoryDescriptor: Object) {
    const buttonOptions = { ...accessoryDescriptor, buttonColor: 'pureIcon' };
    buttonOptions.buttonView = new ButtonView(buttonOptions);

    this._accessoryViewController = new BasicButtonViewController(
      buttonOptions
    );

    const insertionPoint = querySelector(this._element, '.TN');

    insertionPoint.appendChild(buttonOptions.buttonView.getElement());
  }

  _createItemContainerElement(): HTMLElement {
    const itemContainerElement = (this._itemContainerElement = document.createElement(
      'div'
    ));
    itemContainerElement.classList.add('inboxsdk__navItem_container');

    this._element.appendChild(itemContainerElement);

    // If this is a collapsible nav-item, run collapse or expand to set the container styling
    if (this._isCollapsible()) {
      if (this._isCollapsed) this._collapse();
      else this._expand();
    }

    return itemContainerElement;
  }

  _createLinkButtonAccessory(accessoryDescriptor: Object) {
    const linkDiv = document.createElement('div');
    const linkDivClassName = 'inboxsdk__navItem_link';
    linkDiv.setAttribute('class', linkDivClassName);

    const anchor = document.createElement('a');
    anchor.classList.add('CK');
    anchor.textContent = accessoryDescriptor.name;

    linkDiv.appendChild(anchor);

    anchor.href = '#';

    anchor.addEventListener('click', (e: MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();

      accessoryDescriptor.onClick();
    });

    querySelector(this._element, '.aio').appendChild(linkDiv);
  }

  _createPlusButtonAccessory(accessoryDescriptor: Object) {
    const buttonOptions = { ...accessoryDescriptor };
    buttonOptions.buttonView = new CreateAccessoryButtonView();

    this._accessoryViewController = new BasicButtonViewController(
      buttonOptions
    );

    const insertionPoint = querySelector(this._element, '.TN');

    insertionPoint.appendChild(buttonOptions.buttonView.getElement());
  }

  _createSettingsButtonAccessory(accessoryDescriptor: Object) {
    const buttonOptions = { ...accessoryDescriptor };
    buttonOptions.buttonView = new LabelDropdownButtonView(buttonOptions);
    buttonOptions.dropdownViewDriverClass = GmailDropdownView;
    buttonOptions.dropdownPositionOptions = {
      position: 'bottom',
      hAlign: 'left',
      vAlign: 'top'
    };
    buttonOptions.dropdownShowFunction = ({ dropdown }) => {
      dropdown.el.style.marginLeft = '16px';
      buttonOptions.onClick({ dropdown });
    };

    const accessoryViewController = new DropdownButtonViewController(
      buttonOptions
    );
    this._accessoryViewController = accessoryViewController;

    const innerElement = querySelector(this._element, '.TO');
    innerElement.addEventListener('mouseenter', () =>
      innerElement.classList.add('inboxsdk__navItem_hover')
    );
    innerElement.addEventListener('mouseleave', () =>
      innerElement.classList.remove('inboxsdk__navItem_hover')
    );

    const insertionPoint = querySelector(this._element, '.TN');

    insertionPoint.appendChild(buttonOptions.buttonView.getElement());

    this._setupContextClickHandler(accessoryViewController);
  }

  _expand() {
    const expandoElement = this._expandoElement;
    if (expandoElement) {
      expandoElement.classList.add('aih');
      expandoElement.classList.remove('aii');
    } else if (this._type === NAV_ITEM_TYPES.GROUPER) {
      const navItemElement = this._element.firstElementChild;
      if (navItemElement) navItemElement.classList.add('air');
    }

    if (this._itemContainerElement)
      this._itemContainerElement.style.display = '';

    this._isCollapsed = false;

    this._eventStream.emit({
      eventName: 'expanded'
    });

    this._setHeights();
  }

  _getItemContainerElement(): HTMLElement {
    let itemContainerElement = this._itemContainerElement;
    if (!itemContainerElement) {
      itemContainerElement = this._createItemContainerElement();
      this._createExpando();
    }

    return itemContainerElement;
  }

  _isCollapsible() {
    return (
      Boolean(this._expandoElement) || this._type === NAV_ITEM_TYPES.GROUPER
    );
  }

  _isExpanded(): boolean {
    return this._expandoElement
      ? this._expandoElement.classList.contains('aih')
      : false;
  }

  _makeEventMapper(
    eventName: string
  ): (domEvent: Object) => { eventName: string, domEvent: Object } {
    return function(domEvent) {
      domEvent.stopPropagation();
      domEvent.preventDefault();

      return {
        eventName: eventName,
        domEvent: domEvent
      };
    };
  }

  _setHeights() {
    const toElement = querySelector(this._element, '.TO');

    if (this._element.classList.contains('ain') && this._itemContainerElement) {
      this._element.style.height = '';

      const totalHeight = this._element.clientHeight;
      const itemHeight = toElement.clientHeight;

      this._element.style.height = itemHeight + 'px';
      this._element.style.overflow = 'visible';
      this._element.style.marginBottom = totalHeight - itemHeight + 'px';
    } else {
      this._element.style.height = '';
      this._element.style.overflow = '';
      this._element.style.marginBottom = '';
    }
  }

  _setHighlight(value: boolean) {
    if (
      !this._element ||
      this._type === NAV_ITEM_TYPES.LINK ||
      this._type === NAV_ITEM_TYPES.MANAGE
    ) {
      return;
    }

    if (value) {
      querySelector(this._element, '.TO').classList.add('NQ');
    } else {
      querySelector(this._element, '.TO').classList.remove('NQ');
    }
  }

  _setupContextClickHandler(accessoryViewController: Object) {
    Kefir.fromEvents(this._element, 'contextmenu')
      .takeWhile(
        () => this._accessoryViewController === accessoryViewController
      )
      .onValue(domEvent => {
        domEvent.stopPropagation();
        domEvent.preventDefault();

        accessoryViewController.showDropdown();
      });
  }

  _setupElement() {
    this._element = document.createElement('div');
    this._element.setAttribute('class', 'aim inboxsdk__navItem');

    this._element.innerHTML = [
      '<div class="TO">',
      '<div class="TN aik">',

      // This element needs a style attribute defined on it as there is a Gmail css rule of
      // selecting for "gj[style]" the sets the opacity to 1 rather than 0.6.
      '<div class="qj" style="">',
      '</div>',

      '<div class="aio aip">',
      '<span class="nU" role="link">',
      '</span>',
      // This bsU element is the container "subtitle" text.
      '<span class="bsU">',
      '</span>',
      '</div>',

      '</div>',
      '</div>'
    ].join('');

    const innerElement = querySelector(this._element, '.TO');

    Kefir.merge([
      Kefir.fromEvents(innerElement, 'mouseenter').map(
        this._makeEventMapper('mouseenter')
      ),
      Kefir.fromEvents(innerElement, 'mouseleave').map(
        this._makeEventMapper('mouseleave')
      )
    ]).onValue(event => {
      this._updateHighlight(event);
    });

    this._eventStream.plug(
      Kefir.fromEvents(innerElement, 'click').map(
        this._makeEventMapper('click')
      )
    );
  }

  _setupGrouper(navItemDescriptor: Object) {
    const navItemElement = this._element.firstElementChild;
    if (navItemElement) {
      navItemElement.classList.add('n4');

      navItemElement.addEventListener('click', (e: MouseEvent) => {
        e.stopPropagation();
        this._toggleCollapse();
      });

      if (this._isCollapsed) {
        this._collapse();
      } else {
        this._expand();
      }
    }

    const iconContainerElement = querySelector(this._element, '.qj');
    iconContainerElement.innerHTML =
      '<div class="G-asx T-I-J3 J-J5-Ji">&nbsp;</div>';
  }

  _toggleCollapse() {
    if (!this._isCollapsible()) {
      this._isCollapsed = !this._isCollapsed;
      return;
    }

    if (this._isCollapsed) {
      this._expand();
    } else {
      this._collapse();
    }
  }

  _updateAccessory(accessory: Object) {
    if (this._accessory === accessory) {
      return;
    }

    if (this._accessoryViewController) {
      this._accessoryViewController.destroy();
      this._accessoryViewController = null;
    }

    if (accessory) {
      this._createAccessory(accessory);
    }

    this._accessory = accessory;
  }

  _updateClickability(navItemDescriptor: Object) {
    if (
      navItemDescriptor.type === NAV_ITEM_TYPES.LINK ||
      navItemDescriptor.type === NAV_ITEM_TYPES.MANAGE
    ) {
      this._element.classList.add('inboxsdk__navItem_nonClickable');
    } else {
      this._element.classList.remove('inboxsdk__navItem_nonClickable');
    }
  }

  _updateHighlight({ eventName }: { eventName: string }) {
    switch (eventName) {
      case 'mouseenter':
        this._setHighlight(true);

        break;
      case 'mouseleave':
        this._setHighlight(false);

        break;
    }
  }

  _updateIcon(navItemDescriptor: Object) {
    const iconContainerElement = querySelector(this._element, '.qj');

    // render custom icon
    if (navItemDescriptor.iconElement) {
      renderCustomIcon(
        iconContainerElement,
        navItemDescriptor.iconElement,
        navItemDescriptor.iconPosition !== 'BEFORE_NAME'
      );
      return;
    }

    updateIcon(
      this._iconSettings,
      iconContainerElement,
      navItemDescriptor.iconPosition !== 'BEFORE_NAME',
      navItemDescriptor.iconClass,
      navItemDescriptor.iconUrl
    );

    // Setting the border-color of the icon container element while in Gmailv2 will trigger an SDK
    // css rule that will render a circle of border-color if the icon container element has no
    // children i.e. if no iconUrl or iconClass is defined on navItemDescriptor.
    if (
      navItemDescriptor.backgroundColor ||
      (navItemDescriptor.accessory &&
        navItemDescriptor.accessory.buttonBackgroundColor)
    ) {
      const circleColor =
        navItemDescriptor.backgroundColor ||
        navItemDescriptor.accessory.buttonBackgroundColor;
      iconContainerElement.style.borderColor = circleColor;
    }
  }

  _updateName(name: string) {
    if (this._name === name) {
      return;
    }

    const navItemNameElement = querySelector(
      this._element,
      '.inboxsdk__navItem_name'
    );
    navItemNameElement.textContent = name;
    navItemNameElement.setAttribute('title', name);
    if (this._expandoElement) {
      this._expandoElement.title = `Expand ${name}`;
    }
    this._name = name;
  }

  _updateOrder(navItemDescriptor: Object) {
    this._element.setAttribute('data-group-order-hint', '' + this._orderGroup);
    this._element.setAttribute(
      'data-insertion-order-hint',
      '' + this._navItemNumber
    );

    navItemDescriptor.orderHint =
      navItemDescriptor.orderHint || navItemDescriptor.orderHint === 0
        ? navItemDescriptor.orderHint
        : Number.MAX_SAFE_INTEGER;

    if (navItemDescriptor.orderHint !== this._orderHint) {
      this._element.setAttribute(
        'data-order-hint',
        '' + navItemDescriptor.orderHint
      );

      this._eventStream.emit({
        eventName: 'orderChanged'
      });
    }

    this._orderHint = navItemDescriptor.orderHint;
  }

  _updateSubtitle(navItemDescriptor: Object) {
    if (
      navItemDescriptor.accessory &&
      !['SETTINGS_BUTTON', 'DROPDOWN_BUTTON'].includes(
        navItemDescriptor.accessory.type
      ) &&
      navItemDescriptor.type !== NAV_ITEM_TYPES.GROUPER
    ) {
      return;
    }

    querySelector(
      this._element,
      '.bsU'
    ).innerHTML += autoHtml`${navItemDescriptor.subtitle || ''}`;
  }

  _updateType(type: string) {
    if (!this._element) {
      return;
    }

    type = type || NAV_ITEM_TYPES.NAVIGATION;
    if (this._type === type) {
      return;
    }

    const nameElement = this._element.querySelector('.inboxsdk__navItem_name');

    switch (type) {
      case NAV_ITEM_TYPES.GROUPER:
      case NAV_ITEM_TYPES.NAVIGATION:
        if (!nameElement || nameElement.tagName !== 'SPAN') {
          querySelector(
            this._element,
            '.nU'
          ).innerHTML += autoHtml`<span class="inboxsdk__navItem_name">${this._name}</span>`;
        }
        break;
      case NAV_ITEM_TYPES.LINK:
      case NAV_ITEM_TYPES.MANAGE:
        if (!nameElement || nameElement.tagName !== 'A') {
          querySelector(
            this._element,
            '.nU'
          ).innerHTML += autoHtml`<a href="#" class="CK inboxsdk__navItem_name">${this._name}</a>`;
        }
        break;
    }

    this._type = type;
  }

  _updateValues(navItemDescriptor: Object) {
    this._navItemDescriptor = navItemDescriptor;

    this._updateType(navItemDescriptor.type);
    this._updateName(navItemDescriptor.name);
    this._updateSubtitle(navItemDescriptor);
    this._updateOrder(navItemDescriptor);

    if (this._type === NAV_ITEM_TYPES.GROUPER) {
      this._setupGrouper(navItemDescriptor);
      return;
    }

    this._updateIcon(navItemDescriptor);
    this._updateAccessory(navItemDescriptor.accessory);
    this._updateClickability(navItemDescriptor);
  }
}

export function getLeftIndentationPaddingValue(driver: GmailDriver): number {
  return GMAIL_V2_LEFT_INDENTATION_PADDING;
}
