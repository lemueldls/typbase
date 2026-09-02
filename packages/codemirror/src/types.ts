/**
 * A minimal readable text handle. Vue refs (`Ref<string>`) satisfy this shape
 * structurally, so both mnemo and typbase can pass their refs unchanged.
 */
export interface TextRef {
  value: string;
}
