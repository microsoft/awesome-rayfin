import { ChatMessage } from './ChatMessage.js';
import { Image } from './Image.js';
import { Session } from './Session.js';
import { Slideshow } from './Slideshow.js';

export type SlideDeckSchema = {
  Slideshow: Slideshow;
  Session: Session;
  ChatMessage: ChatMessage;
  Image: Image;
};

export const schema = [Slideshow, Session, ChatMessage, Image];
