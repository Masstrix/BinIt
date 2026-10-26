import { useEffect, useState } from "react";
import { ApiError, api, deviceToken, store, useAppState, type Driver } from "../api";
import { readStored, writeStored } from "../persist";
import { ColorPicker } from "../pages/Drivers";
import { Helmet, Logo } from "./Helmet";

/**
 * The sign-in for a phone or browser that is not the PC and has not been paired yet. Pick yourself (or add yourself)
 * and this device is paired to that driver by the server; a driver who already has a phone asks for a 6 digit code.
 * The desktop app never shows this: it is the host.
 */
export function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const { drivers } = useAppState();
  const [step, setStep] = useState<"pick" | "new" | "code">("pick");
  const [picked, setPicked] = useState<Driver | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [color, setColor] = useState("#B79BFF");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const done = (token: string) => {
    deviceToken.set(token);
    store.refreshAll().catch(() => {});
    onSignedIn();
  };

  // A phone that remembered a driver before pairing existed: sign it in quietly if that driver is still free.
  useEffect(() => {
    const old = readStored<number | null>("me", null, (v) => typeof v === "number");
    if (old == null || deviceToken.get()) return;
    writeStored("me", null);
    api.pair(old).then((r) => done(r.token)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      if (e instanceof ApiError && e.code === "codeNeeded") {
        setStep("code");
        setCode("");
      } else {
        setError((e as Error).message);
      }
    } finally {
      setBusy(false);
    }
  };

  const signIn = (withCode?: string) =>
    run(async () => {
      if (!picked) return;
      done((await api.pair(picked.id, withCode)).token);
    });

  const create = () =>
    run(async () => {
      const d = await api.addDriver(name.trim(), color, false);
      done((await api.pair(d.id)).token);
    });

  return (
    <div className="signin">
      <div className="signin-card">
        <div className="signin-brand">
          <Logo size={36} />
          <span>bin it</span>
        </div>

        {step === "pick" && (
          <form
            className="signin-step"
            onSubmit={(e) => {
              e.preventDefault();
              signIn();
            }}
          >
            <div>
              <h1>Who are you?</h1>
              <p className="muted">Only this phone remembers it. Laps go to whoever is in the seat, so sign in as yourself once and you are set.</p>
            </div>
            <div className="signin-grid" role="radiogroup" aria-label="Drivers">
              {drivers.map((d) => (
                <button key={d.id} type="button" role="radio" aria-checked={picked?.id === d.id} className="signin-tile" onClick={() => { setPicked(d); setError(null); }}>
                  <span className="signin-face" style={{ background: `${d.color}2E` }}>
                    <Helmet color={d.color} look={d.look} size={58} tile={false} seed={d.id} />
                  </span>
                  <span className="signin-name">{d.name}</span>
                  {d.look?.number != null && <span className="signin-num">#{d.look.number}</span>}
                </button>
              ))}
              <button type="button" className="signin-tile signin-add" onClick={() => { setStep("new"); setError(null); }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
                Add me
              </button>
            </div>
            {error && <span className="error" role="alert">{error}</span>}
            <button className="btn big signin-go" type="submit" disabled={!picked || busy}>
              {picked ? `That's me, ${picked.name}` : "Pick yourself"}
            </button>
          </form>
        )}

        {step === "new" && (
          <form
            className="signin-step"
            onSubmit={(e) => {
              e.preventDefault();
              create();
            }}
          >
            <div>
              <h1>New driver</h1>
              <p className="muted">Just a name and a colour. This phone will be you from now on.</p>
            </div>
            <div className="signin-new">
              <Helmet color={color} size={96} />
              <input className="input" aria-label="Your name" placeholder="Your name" maxLength={32} value={name} onChange={(e) => setName(e.target.value)} autoFocus style={{ minHeight: 56, fontSize: 20, fontWeight: 700, textAlign: "center", width: "100%" }} />
              <ColorPicker value={color} onChange={setColor} />
            </div>
            {error && <span className="error" role="alert">{error}</span>}
            <button className="btn big signin-go" type="submit" disabled={!name.trim() || busy}>Let's race</button>
            <button type="button" className="btn ghost" onClick={() => { setStep("pick"); setError(null); }}>Back</button>
            <span className="muted" style={{ fontSize: 13, textAlign: "center" }}>No passwords: anyone can pick any name. Play fair.</span>
          </form>
        )}

        {step === "code" && picked && (
          <form
            className="signin-step"
            onSubmit={(e) => {
              e.preventDefault();
              signIn(code);
            }}
          >
            <div>
              <h1>{picked.name} already has a phone</h1>
              <p className="muted">
                To sign in as {picked.name} here, enter the 6 digit code. Get it on the PC (open {picked.name}'s profile, then Connections) or on {picked.name}'s own phone (tap the banner, then Pair another phone).
              </p>
            </div>
            <input
              className="input code-input mono"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              aria-label="Pairing code"
              autoFocus
            />
            {error && <span className="error" role="alert">{error}</span>}
            <button className="btn big signin-go" type="submit" disabled={code.length !== 6 || busy}>Sign in</button>
            <button type="button" className="btn ghost" onClick={() => { setStep("pick"); setError(null); }}>Back</button>
          </form>
        )}
      </div>
    </div>
  );
}
