import { passwordSession } from "airspace";

export interface AuthOptions {
  identifier?: string;
  password?: string;
  service?: string;
}

export interface PublishSession {
  session: Awaited<ReturnType<typeof passwordSession>>;
  did: string;
}

/** App-password login for CI and non-interactive publishing. */
export async function publishSession(options: AuthOptions): Promise<PublishSession> {
  const identifier = options.identifier ?? process.env.ATP_IDENTIFIER;
  const password = options.password ?? process.env.ATP_PASSWORD;
  const service = options.service ?? process.env.ATP_SERVICE ?? "https://bsky.social";

  if (!identifier) throw new Error("Set --identifier or ATP_IDENTIFIER.");
  if (!password) throw new Error("Set --password or ATP_PASSWORD.");
  if (!service) throw new Error("Set --service or ATP_SERVICE.");

  const session = await passwordSession({ identifier, password, service });

  return { session, did: session.did };
}
