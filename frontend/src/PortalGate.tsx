import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { configureApi } from "./api/client";
import type { ServerHandshake } from "./api/generated";
import { Button, ErrorNotice, Input, Modal } from "./components/ui";
import { isPortal, portal, validateServer, type ServerProfile } from "./portal";

export function PortalGate({
  children,
}: {
  children: (context: {
    handshake: ServerHandshake;
    profile: ServerProfile | null;
    secureStorageAvailable: boolean;
    changeServer: () => void;
  }) => ReactNode;
}) {
  const [profiles, setProfiles] = useState<ServerProfile[]>([]);
  const [active, setActive] = useState<ServerProfile | null>(null);
  const [handshake, setHandshake] = useState<ServerHandshake | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [secureStorageAvailable, setSecureStorageAvailable] = useState(true);

  useEffect(() => {
    if (!isPortal) {
      fetch("/api/v1/server")
        .then(async (response) => {
          if (!response.ok) throw new Error("Unable to load server identity.");
          setHandshake((await response.json()) as ServerHandshake);
        })
        .catch(setError)
        .finally(() => setLoading(false));
      return;
    }
    portal
      .listProfiles()
      .then(setProfiles)
      .catch(setError)
      .finally(() => setLoading(false));
  }, []);

  async function selectProfile(profile: ServerProfile) {
    setError(null);
    setLoading(true);
    try {
      const validated = await validateServer(profile.url);
      let token: string | null = null;
      try {
        token = await portal.loadCredential(profile.serverUuid);
        setSecureStorageAvailable(true);
      } catch {
        setSecureStorageAvailable(false);
      }
      configureApi({
        baseUrl: profile.url,
        bearerToken: token,
        csrfToken: null,
      });
      const updated = { ...profile, lastUsedAt: new Date().toISOString() };
      setProfiles(await portal.saveProfile(updated));
      setActive(updated);
      setHandshake(validated.handshake);
    } catch (caught) {
      setError(caught);
    } finally {
      setLoading(false);
    }
  }

  if (loading)
    return (
      <Centered>
        <p>Loading FeltnerAI…</p>
      </Centered>
    );
  if (!isPortal && handshake) {
    return (
      <>
        {children({
          handshake,
          profile: null,
          secureStorageAvailable: true,
          changeServer: () => undefined,
        })}
      </>
    );
  }
  if (active && handshake) {
    return (
      <>
        {children({
          handshake,
          profile: active,
          secureStorageAvailable,
          changeServer: () => {
            setActive(null);
            setHandshake(null);
            configureApi({ baseUrl: "", bearerToken: null, csrfToken: null });
          },
        })}
      </>
    );
  }
  return (
    <Centered>
      <div className="panel w-[min(92vw,42rem)] rounded-3xl p-7">
        <p className="text-sm font-bold tracking-[0.18em] text-[var(--accent)] uppercase">
          FeltnerAI Portal
        </p>
        <h1 className="mt-2 text-3xl font-bold">Choose a server</h1>
        <p className="mt-2 text-[var(--muted)]">
          Portal keeps server profiles on this device and credentials in the
          operating system credential manager.
        </p>
        <ErrorNotice error={error} />
        <div className="mt-6 grid gap-3">
          {profiles.map((profile) => (
            <div
              key={profile.id}
              className="flex overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel-solid)] transition hover:border-[var(--accent)]"
            >
              <button
                onClick={() => void selectProfile(profile)}
                className="min-w-0 flex-1 p-4 text-left"
              >
                <strong className="block">{profile.name}</strong>
                <span className="block truncate text-sm text-[var(--muted)]">
                  {profile.url}
                </span>
              </button>
              <button
                className="px-4 text-sm font-semibold text-[var(--danger)] hover:bg-red-500/10"
                aria-label={`Remove ${profile.name}`}
                onClick={() =>
                  void portal
                    .deleteProfile(profile.id, profile.serverUuid)
                    .then(setProfiles)
                    .catch(setError)
                }
              >
                Remove
              </button>
            </div>
          ))}
          {!profiles.length && (
            <p className="rounded-2xl border border-dashed border-[var(--border)] p-8 text-center text-[var(--muted)]">
              No servers saved yet.
            </p>
          )}
        </div>
        <Button className="mt-5 w-full" onClick={() => setShowAdd(true)}>
          Add server
        </Button>
      </div>
      <AddServer
        open={showAdd}
        onOpenChange={setShowAdd}
        onAdded={(profile) => {
          setProfiles((current) => [profile, ...current]);
          void selectProfile(profile);
        }}
      />
    </Centered>
  );
}

function AddServer({
  open,
  onOpenChange,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: (profile: ServerProfile) => void;
}) {
  const [url, setUrl] = useState("");
  const [warningAccepted, setWarningAccepted] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const insecure = url.trim().toLowerCase().startsWith("http://");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (insecure && !warningAccepted) {
      setError(
        new Error("Acknowledge the HTTP transport warning before continuing."),
      );
      return;
    }
    try {
      const validated = await validateServer(url);
      onOpenChange(false);
      onAdded({
        id: crypto.randomUUID(),
        serverUuid: validated.handshake.server_uuid,
        name: validated.handshake.branding.server_name,
        url: validated.url,
        allowInsecureHttp: insecure,
        lastUsedAt: new Date().toISOString(),
      });
    } catch (caught) {
      setError(caught);
    }
  }
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Add a FeltnerAI server"
    >
      <form className="grid gap-4" onSubmit={submit}>
        <Input
          label="Server URL"
          type="url"
          required
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://ai.example.com"
        />
        {insecure && (
          <label className="flex gap-3 rounded-xl border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
            <input
              type="checkbox"
              checked={warningAccepted}
              onChange={(event) => setWarningAccepted(event.target.checked)}
            />
            <span>
              <strong>HTTP is not encrypted.</strong> Credentials and
              conversations may be intercepted. Continue only on a network you
              trust.
            </span>
          </label>
        )}
        <ErrorNotice error={error} />
        <Button type="submit">Validate and add</Button>
      </form>
    </Modal>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center p-5">{children}</main>
  );
}
