"use client";

import { useEffect, useRef, useState } from "react";
import { arc } from "viem/chains";
import { useConnect, useConnection, useConnectors, useDisconnect, useSwitchChain } from "wagmi";
import styles from "./Connect.module.css";

export function short(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** Wallet button: lists every injected (EIP-6963) wallet, and offers to switch to Arc when needed. */
export function Connect() {
  const { address, chainId, status } = useConnection();
  const connectors = useConnectors();
  const connect = useConnect();
  const disconnect = useDisconnect();
  const switchChain = useSwitchChain();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  if (!mounted) return <div className={styles.slot} />;

  if (status === "connected" && address) {
    if (chainId !== arc.id) {
      return (
        <button className="btn small" onClick={() => switchChain.mutate({ chainId: arc.id })}>
          Switch to Arc
        </button>
      );
    }
    return (
      <div className={styles.wrap} ref={ref}>
        <button className={styles.addr} onClick={() => setOpen((o) => !o)}>
          <span className={styles.dot} />
          {short(address)}
        </button>
        {open && (
          <div className={styles.menu}>
            <span className="label">Arc mainnet · 5042</span>
            <button
              className="btn ghost small"
              onClick={() => {
                disconnect.mutate();
                setOpen(false);
              }}
            >
              Disconnect
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={styles.wrap} ref={ref}>
      <button className="btn small" onClick={() => setOpen((o) => !o)} disabled={status === "connecting"}>
        {status === "connecting" ? "Connecting…" : "Connect wallet"}
      </button>
      {open && (
        <div className={styles.menu}>
          {(connectors as readonly unknown[]).length === 0 && <p className="faint">No browser wallet found.</p>}
          {connectors.map((c) => (
            <button
              key={c.uid}
              className={styles.option}
              onClick={() => {
                connect.mutate({ connector: c, chainId: arc.id });
                setOpen(false);
              }}
            >
              {c.icon && <img src={c.icon} alt="" width={18} height={18} />}
              {c.name}
            </button>
          ))}
          <p className={styles.note}>Arc pays gas in USDC. The wallet will be asked to add Arc (chain 5042) if it does not know it.</p>
        </div>
      )}
    </div>
  );
}
