export type IntentReceiverCommand = {
    kind: 'status' | 'help' | 'cancel';
} | {
    kind: 'publish' | 'recover' | 'retry' | 'project';
    candidateId: string;
};
export declare const intentReceiverHelp = "/intent receiver publish <\u5019\u9009ID>  \u539F\u751F\u6279\u51C6\u5E76\u53D1\u5E03\u539F\u5DF2\u9A8C\u8BC1\u4EA7\u7269\n/intent receiver recover <\u5019\u9009ID>  \u53EA\u6536\u655B\u539F\u53D1\u5E03\u8BF7\u6C42\uFF0C\u4E0D\u91CD\u590D\u539F\u751F\u6279\u51C6\n/intent receiver retry <\u5019\u9009ID>    \u539F\u672A\u6279\u51C6\u8BF7\u6C42\u5C01\u53E3\u540E\u663E\u5F0F\u65B0\u5C1D\u8BD5\n/intent receiver project <\u5019\u9009ID>  \u91CD\u65B0\u5B8C\u6574\u9A8C\u8BC1\u540E\u6295\u5F71\u539F\u9636\u6BB5\uFF0C\u4E0B\u4E00\u9636\u6BB5\u9700\u663E\u5F0F\u7EE7\u7EED\n/intent receiver status            \u8BFB\u53D6\u5386\u53F2\uFF0C\u4E0D\u4EE3\u8868\u5F53\u524D\u6709\u6548\n/intent receiver cancel            \u8BF7\u6C42\u4E2D\u65AD\u5E76\u7B49\u5F85\u5B9E\u9645\u6392\u7A7A\n\u7236\u7EA7\u672A\u53D1\u5E03\u65F6\uFF0C\u5168\u90E8\u9636\u6BB5\u5B8C\u6210\u4ECD\u4E0D\u4EE3\u8868\u6574\u4E2A Intent \u5B8C\u6210\u3002";
export declare function parseIntentReceiverCommand(text: string): IntentReceiverCommand | null;
