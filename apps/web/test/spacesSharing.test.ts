import {
  parseWorkspaceInvite,
  parseWorkspaceSpaceRef,
  WORKSPACE_SPACE_TYPE,
  workspaceInviteUri,
  workspaceSpaceRef,
} from "@typbase/spaces";
import { describe, expect, it } from "vitest";

describe("workspace space ref", () => {
  it("builds the full at:// space URI", () => {
    const ref = workspaceSpaceRef("did:plc:alice", "work");
    expect(ref).toEqual({
      uri: `at://did:plc:alice/space/${WORKSPACE_SPACE_TYPE}/work`,
      ownerDid: "did:plc:alice",
      skey: "work",
    });
  });

  it("parses a pasted workspace URI", () => {
    const uri = workspaceSpaceRef("did:plc:bob", "notes").uri;
    expect(parseWorkspaceSpaceRef(uri)).toEqual({
      uri,
      ownerDid: "did:plc:bob",
      skey: "notes",
    });
  });

  it("carries the invite role as a fragment", () => {
    const ref = workspaceSpaceRef("did:plc:alice", "work");
    expect(parseWorkspaceInvite(workspaceInviteUri(ref, "editor"))).toEqual({
      ...ref,
      role: "editor",
    });
    expect(parseWorkspaceInvite(ref.uri)).toEqual({ ...ref, role: "viewer" });
    expect(parseWorkspaceInvite(`${ref.uri}#viewer`)).toEqual({ ...ref, role: "viewer" });
  });

  it("rejects another space type and a public record URI", () => {
    expect(parseWorkspaceSpaceRef("at://did:plc:alice/space/com.example.other/work")).toBeNull();
    expect(parseWorkspaceSpaceRef("at://did:plc:alice/at.typbase.workspace/work")).toBeNull();
    expect(parseWorkspaceSpaceRef("not a URI")).toBeNull();
  });
});
