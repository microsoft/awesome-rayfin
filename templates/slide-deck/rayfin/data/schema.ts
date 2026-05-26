import { ChatMessage } from './ChatMessage.js';
import { Session } from './Session.js';
import { Slideshow } from './Slideshow.js';

export type SlideDeckSchema = {
  Slideshow: Slideshow;
  Session: Session;
  ChatMessage: ChatMessage;
};

export const schema = [Slideshow, Session, ChatMessage];
