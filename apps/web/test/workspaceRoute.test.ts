import { describe, expect, it } from "vitest";

import { isWorkspaceLocation, workspaceIdFromPath, workspacePath } from "../src/lib/workspaceRoute";

describe("workspaceRoute", () => {
  it("formats the canonical workspace path", () => {
    expect(workspacePath("abc123")).toBe("/w/abc123");
    expect(workspacePath("local")).toBe("/w/local");
  });

  it("reads a workspace id from the path", () => {
    expect(workspaceIdFromPath("/w/abc123")).toBe("abc123");
    expect(workspaceIdFromPath("/w/abc123/")).toBe("abc123");
    expect(workspaceIdFromPath("/w/local")).toBe("local");
  });

  it("returns no id for the root alias and unrelated paths", () => {
    expect(workspaceIdFromPath("/")).toBe("");
    expect(workspaceIdFromPath("/u/did:plc:test")).toBe("");
    expect(workspaceIdFromPath("/w")).toBe("");
    expect(workspaceIdFromPath("/w/abc/extra")).toBe("");
  });

  it("allows only the root alias and one workspace segment", () => {
    expect(isWorkspaceLocation("/")).toBe(true);
    expect(isWorkspaceLocation("/w/abc123")).toBe(true);
    expect(isWorkspaceLocation("/w/abc123/")).toBe(true);
    expect(isWorkspaceLocation("/w")).toBe(false);
    expect(isWorkspaceLocation("/w/abc123/extra")).toBe(false);
    expect(isWorkspaceLocation("/u/did:plc:test")).toBe(false);
  });

  it("survives a malformed escape", () => {
    expect(workspaceIdFromPath("/w/%E0%A4%A")).toBe("");
  });
});
