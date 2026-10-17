// Approved R65 regression support. Literal boundary population; no production invocation.
export const ASCII_ESCAPE_BOUNDARIES = [
  {"id": "ascii7e", "input": "~", "expectedEscape": "~", "canonicalJson": "\"~\"", "expectedCanonicalEscape": "\"~\"", "legalPath": "out-~.txt", "rawLoopReachableThroughCanonicalJson": true},
  {"id": "del7f", "input": "\u007f", "expectedEscape": "\\u007f", "canonicalJson": "\"\u007f\"", "expectedCanonicalEscape": "\"\\u007f\"", "legalPath": "out-\u007f.txt", "rawLoopReachableThroughCanonicalJson": true},
  {"id": "nonascii80", "input": "\u0080", "expectedEscape": "\\u0080", "canonicalJson": "\"\u0080\"", "expectedCanonicalEscape": "\"\\u0080\"", "legalPath": "out-\u0080.txt", "rawLoopReachableThroughCanonicalJson": true},
  {"id": "maxffff", "input": "\uffff", "expectedEscape": "\\uffff", "canonicalJson": "\"\uffff\"", "expectedCanonicalEscape": "\"\\uffff\"", "legalPath": "out-\uffff.txt", "rawLoopReachableThroughCanonicalJson": true},
  {"id": "astral", "input": "\ud83d\ude00", "expectedEscape": "\\ud83d\\ude00", "canonicalJson": "\"\ud83d\ude00\"", "expectedCanonicalEscape": "\"\\ud83d\\ude00\"", "legalPath": "out-\ud83d\ude00.txt", "rawLoopReachableThroughCanonicalJson": true},
  {"id": "lone-high", "input": "\ud800", "expectedEscape": "\\ud800", "canonicalJson": "\"\\ud800\"", "expectedCanonicalEscape": "\"\\ud800\"", "legalPath": "out-\ud800.txt", "rawLoopReachableThroughCanonicalJson": false},
  {"id": "lone-low", "input": "\udc00", "expectedEscape": "\\udc00", "canonicalJson": "\"\\udc00\"", "expectedCanonicalEscape": "\"\\udc00\"", "legalPath": "out-\udc00.txt", "rawLoopReachableThroughCanonicalJson": false},
] as const;
