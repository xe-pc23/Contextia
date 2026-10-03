import { createContext, useContext, type ReactNode } from 'react';
import { messagesFor, type Messages } from './messages';

const I18nContext = createContext<Messages>(messagesFor('ja'));

export function I18nProvider({ messages, children }: { messages: Messages; children: ReactNode }) {
  return <I18nContext.Provider value={messages}>{children}</I18nContext.Provider>;
}

export function useMessages(): Messages {
  return useContext(I18nContext);
}
