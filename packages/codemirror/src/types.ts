/**
 * A minimal readable text handle. Vue refs (`Ref<string>`) satisfy this shape
 * structurally, so both mnemo and Typbase can pass their refs unchanged.
 */
export interface TextRef {
  value: string;
}
