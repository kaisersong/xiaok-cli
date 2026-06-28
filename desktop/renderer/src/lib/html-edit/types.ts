export type EditableElementKind = 'text' | 'link';

export interface InlineStylePatch {
  color?: string;
  fontSize?: string;
  fontFamily?: string;
  fontWeight?: string;
}

export interface EditTarget {
  id: string;
  kind: EditableElementKind;
  tagName: string;
  selector: string;
  text: string;
  outerHtml: string;
  sourceOccurrence?: number;
  href?: string;
  style?: InlineStylePatch;
}

export type PatchKind = 'set-text' | 'set-link' | 'remove-element' | 'insert-image-after' | 'insert-svg-after' | 'set-style';

export interface EditPatch {
  targetId: string;
  kind: PatchKind;
  payload: {
    text?: string;
    href?: string;
    style?: InlineStylePatch;
    imageUrl?: string;
    imageAlt?: string;
    caption?: string;
    svgSource?: string;
  };
}

export interface EditPatchResult {
  source: string;
  updatedTarget: EditTarget;
}
