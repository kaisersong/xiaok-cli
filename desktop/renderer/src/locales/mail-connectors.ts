import type { MailProvider,MailErrorCode } from '../../../shared/mail-connectors-ipc-contract';
export interface MailConnectorLabels {
 authCodeTitle:string;authCodeHint:string;openWebmail:(name:string)=>string;authGuides:Record<'qq'|'netease163',string[]>;
 smtpHost:string;smtpPort:string;smtpHelp:string;
 title:string;description:string;search:string;all:string;connected:string;add:(name:string)=>string;accountCount:(count:number)=>string;
 accountsTitle:string;empty:string;noMatches:string;loading:string;readFailed:string;refresh:string;unknown:string;close:string;
 email:string;password:string;host:string;port:string;grant:string;grantDescription:string;connect:string;connecting:string;
 clientId:string;clientSecret:string;oauthSetup:string;oauthConnect:string;oauthWaiting:string;oauthExchanging:string;oauthCancel:string;
 oauthCancelled:string;oauthFailed:string;oauthTimedOut:string;readOnly:string;settingsHelp:string;manage:string;test:string;preview:string;
 remove:(email:string)=>string;removeConfirm:string;removeNotice:string;cancel:string;saveAccess:string;reconnect:string;
 subject:string;sender:string;received:string;noMessages:string;previewPartial:string;bodyTruncated:string;verified:(time:string)=>string;
 status:Record<'saved'|'connected'|'needs_reconnect'|'error',string>;providers:Record<MailProvider,{name:string;description:string;badge:string;help:string}>;
 errors:Record<MailErrorCode,string>;
}
