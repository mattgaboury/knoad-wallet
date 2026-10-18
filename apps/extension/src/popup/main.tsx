import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import QRCode from "qrcode";
import { getChain } from "@knoad/wallet-core";
import type { RelayRecord } from "../protocol";

type State = {
  record: RelayRecord;
  pendingOrigins: string[];
  phoneWaiting: boolean;
};

function Popup() {
  const [state, setState] = useState<State | null>(null);
  const [projectId, setProjectId] = useState("");
  const [qr, setQr] = useState("");
  const [note, setNote] = useState("");

  async function refresh() {
    const next = (await chrome.runtime.sendMessage({ type: "get-state" })) as State;
    setState(next);
    setProjectId(next.record.projectId);
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1000);
    return () => window.clearInterval(timer);
  }, []);

  async function saveProject() {
    await chrome.runtime.sendMessage({ type: "set-project", projectId: projectId.trim() });
    await refresh();
  }

  async function pair() {
    setNote("");
    const response = (await chrome.runtime.sendMessage({ type: "start-pair" })) as { uri?: string; error?: string };
    if (response.error || !response.uri) {
      setNote(response.error ?? "Could not start pairing.");
      return;
    }
    setQr(await QRCode.toDataURL(response.uri, { margin: 1, width: 220, color: { dark: "#050807", light: "#f2f7f3" } }));
    setNote("Scan this in the KNOAD app.");
  }

  async function disconnect() {
    setQr("");
    await chrome.runtime.sendMessage({ type: "disconnect" });
    await refresh();
  }

  async function decide(origin: string, accepted: boolean) {
    await chrome.runtime.sendMessage({ type: "decide-origin", origin, accepted });
    await refresh();
  }

  const record = state?.record;
  const chain = record ? getChain(record.chainId) : undefined;

  return (
    <main>
      <img src="icons/icon128.png" alt="" width={36} height={36} />
      <h1 className="knoad-title">KNOAD Wallet</h1>
      <p className="muted">Signing stays on your phone.</p>
      {note ? <p className="muted">{note}</p> : null}
      {state?.phoneWaiting ? <p className="waiting">Waiting for your phone</p> : null}

      <label className="knoad-label">Connection id</label>
      <input className="knoad-field" value={projectId} onChange={(event) => setProjectId(event.target.value)} />
      <button className="knoad-button knoad-button-outline" type="button" onClick={() => void saveProject()}>
        Save
      </button>

      {record?.account ? (
        <section className="knoad-card">
          <span className="knoad-label">Account</span>
          <div className="knoad-address">{record.account}</div>
          <span className="knoad-label">Chain</span>
          <div>{chain?.name ?? record.chainId}</div>
          <button className="knoad-button knoad-button-danger" type="button" onClick={() => void disconnect()}>
            Disconnect
          </button>
        </section>
      ) : (
        <button className="knoad-button knoad-button-primary" type="button" onClick={() => void pair()}>
          Connect phone
        </button>
      )}

      {qr ? <img className="qr" src={qr} alt="Pairing code" /> : null}

      {state?.pendingOrigins.map((origin) => (
        <section className="knoad-card" key={origin}>
          <span className="knoad-label">Site wants to connect</span>
          <div>{origin}</div>
          <button className="knoad-button knoad-button-primary" type="button" onClick={() => void decide(origin, true)}>
            Approve site
          </button>
          <button className="knoad-button knoad-button-danger" type="button" onClick={() => void decide(origin, false)}>
            Deny site
          </button>
        </section>
      ))}
    </main>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(<Popup />);
