import type * as Kefir from 'kefir';
import type { AttachmentCardViewDriver } from './driver';
import SafeEventEmitter from '../lib/safe-event-emitter';
import { Contact } from '../../inboxsdk';
export type VIEW_STATE = 'HIDDEN' | 'COLLAPSED' | 'EXPANDED';
export type MessageViewLinkDescriptor = {
  text: string;
  html: string;
  element: HTMLElement;
  href: string;
  isInQuotedArea: boolean;
};
export type MessageViewToolbarButtonDescriptor = {
  section: 'MORE';
  title: string;
  iconUrl?: string | null | undefined;
  iconClass?: string | null | undefined;
  onClick(): void;
  orderHint?: number | null | undefined;
};
export type AttachmentIcon = SafeEventEmitter & {};
export type MessageViewDriver = {
  getMessageID(): string;
  getMessageIDAsync(): Promise<string>;
  getContentsElement(): HTMLElement;
  isElementInQuotedArea(el: HTMLElement): boolean;
  addMoreMenuItem(options: MessageViewToolbarButtonDescriptor): void;
  addAttachmentIcon(options: Record<string, any>): AttachmentIcon;
  getAttachmentCardViewDrivers(): Array<AttachmentCardViewDriver>;
  addAttachmentCard(options: Record<string, any>): AttachmentCardViewDriver;
  addButtonToDownloadAllArea(options: Record<string, any>): void;
  getEventStream(): Kefir.Observable<Record<string, any>, unknown>;
  getViewState(): VIEW_STATE;
  getDateString(): string;
  getSender(): Contact;
  getReadyStream(): Kefir.Observable<any, unknown>;
  getRecipients(): Array<Contact>;
  getRecipientEmailAddresses(): Array<string>;
  getRecipientsFull(): Promise<Array<Contact>>;
  getThreadViewDriver(): Record<string, any>;
  isLoaded(): boolean;
  hasOpenReply(): boolean;
};