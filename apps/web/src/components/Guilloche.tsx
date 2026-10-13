"use client";

import { useEffect, useRef } from "react";
import styles from "./Guilloche.module.css";

const NS = "http://www.w3.org/2000/svg";

interface Props {
  /** Show the UV lamp: a torch that follows the pointer and reveals the fluorescent layer. */
  lamp?: boolean;
  /** Text printed in UV ink under the lamp. */
  readings?: string;
  /** Vertical positions of the two guilloché bands, as fractions of the viewport. */
  bands?: [number, number];
}

/**
 * Banknote security print, drawn in code: a fine wave field, two interlaced guilloché bands, and,
 * with `lamp`, a fluorescent copy of all of it (plus fibres and microtext) that only shows under a
 * torch following the pointer, idling on a slow Lissajous when the pointer is away.
 */
export function Guilloche({ lamp = false, readings = "", bands = [0.17, 0.87] }: Props) {
  const [bandTop, bandBottom] = bands;
  const base = useRef<SVGSVGElement>(null);
  const fluo = useRef<SVGSVGElement>(null);
  const rows = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let seed = 7;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    const path = (fn: (x: number) => number, w: number, step: number) => {
      let d = `M0 ${fn(0).toFixed(1)}`;
      for (let x = step; x <= w + step; x += step) d += `L${x} ${fn(x).toFixed(1)}`;
      return d;
    };
    const fill = (g: Element | null, ds: string[], delay: number) => {
      if (!g) return;
      g.replaceChildren(
        ...ds.map((d, i) => {
          const p = document.createElementNS(NS, "path");
          p.setAttribute("d", d);
          p.style.animationDelay = `${delay + i * (0.6 / ds.length)}s`;
          return p;
        }),
      );
    };

    const build = () => {
      const W = window.innerWidth;
      const H = window.innerHeight;
      const mob = W < 720;
      const field: string[] = [];
      for (let y0 = -10; y0 < H + 20; y0 += mob ? 12 : 14) {
        field.push(
          path((x) => y0 + 6 * Math.sin((x * 2 * Math.PI) / 420 + y0 * 0.021) + 2.6 * Math.sin((x * 2 * Math.PI) / 97 + y0 * 0.05), W, 8),
        );
      }
      const band: string[] = [];
      [bandTop, bandBottom].forEach((frac, bi) => {
        const cy = H * frac;
        const n = 26;
        const A = mob ? 16 : 24;
        const p1 = mob ? 120 : 180;
        const p2 = mob ? 520 : 900;
        for (let i = 0; i < n; i++) {
          band.push(path((x) => cy + A * Math.sin((x * 2 * Math.PI) / p1 + i * 0.24) * Math.cos((x * 2 * Math.PI) / p2 - i * 0.07 + bi) + (i - n / 2) * 0.9, W, 4));
          band.push(
            path((x) => cy - A * Math.sin((x * 2 * Math.PI) / p1 + i * 0.24 + Math.PI / 2) * Math.cos((x * 2 * Math.PI) / p2 - i * 0.07 + bi) + (i - n / 2) * 0.9, W, 4),
          );
        }
      });
      fill(base.current?.querySelector(".field") ?? null, field, 0);
      fill(base.current?.querySelector(".band") ?? null, band, 0.15);
      if (!lamp || !fluo.current) return;
      fill(fluo.current.querySelector(".field"), field, 0);
      fill(fluo.current.querySelector(".band"), band, 0.15);
      seed = 7;
      const fibres: SVGPathElement[] = [];
      const count = Math.round((W * H) / 9000);
      for (let k = 0; k < count; k++) {
        const x = rnd() * W;
        const y = rnd() * H;
        const a = rnd() * Math.PI * 2;
        const len = 6 + rnd() * 12;
        const x2 = x + Math.cos(a) * len;
        const y2 = y + Math.sin(a) * len;
        const cx = (x + x2) / 2 + (rnd() - 0.5) * 8;
        const cy = (y + y2) / 2 + (rnd() - 0.5) * 8;
        const p = document.createElementNS(NS, "path");
        p.setAttribute("d", `M${x.toFixed(1)} ${y.toFixed(1)}Q${cx.toFixed(1)} ${cy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`);
        if (rnd() > 0.55) p.setAttribute("class", styles.lilac);
        p.style.animationDelay = `${0.3 + rnd() * 0.5}s`;
        fibres.push(p);
      }
      fluo.current.querySelector(".fibres")?.replaceChildren(...fibres);
      if (rows.current) {
        const line = `${readings}   `;
        const els: HTMLDivElement[] = [];
        for (let r = 0; r < Math.ceil(H / 46); r++) {
          const dv = document.createElement("div");
          dv.className = styles.row;
          dv.style.top = `${22 + r * 46}px`;
          dv.style.textIndent = `${-((r * 137) % 600)}px`;
          dv.textContent = line.repeat(6);
          els.push(dv);
        }
        rows.current.replaceChildren(...els);
      }
      root.current?.style.setProperty("--lamp", `${mob ? 160 : 260}px`);
    };

    build();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onResize = () => {
      clearTimeout(timer);
      timer = setTimeout(build, 150);
    };
    window.addEventListener("resize", onResize);
    root.current?.classList.add(styles.ready);

    if (!lamp) return () => window.removeEventListener("resize", onResize);

    const el = document.documentElement;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let pointerAt = 0;
    let frame = 0;
    const t0 = performance.now();
    const setLamp = (x: number, y: number) => {
      el.style.setProperty("--lx", `${x}px`);
      el.style.setProperty("--ly", `${y}px`);
    };
    const onPointer = (e: PointerEvent) => {
      pointerAt = performance.now();
      setLamp(e.clientX, e.clientY);
    };
    const idle = (now: number) => {
      if (now - pointerAt > 4000) {
        const W = window.innerWidth;
        const H = window.innerHeight;
        const t = (now - t0) / 1000;
        const yc = W < 720 ? 0.62 : 0.5;
        setLamp(W * (0.5 + 0.32 * Math.sin((2 * Math.PI * t) / 20 + 0.32)), H * (yc + 0.26 * Math.sin((2 * Math.PI * 2 * t) / 20 - 0.08)));
      }
      frame = requestAnimationFrame(idle);
    };
    window.addEventListener("pointermove", onPointer);
    window.addEventListener("pointerdown", onPointer);
    if (reduce) setLamp(window.innerWidth * 0.76, window.innerHeight * 0.74);
    else frame = requestAnimationFrame(idle);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("pointerdown", onPointer);
      cancelAnimationFrame(frame);
    };
  }, [lamp, readings, bandTop, bandBottom]);

  return (
    <div ref={root} className={styles.root} aria-hidden>
      <svg ref={base} className={styles.base}>
        <g className="field" />
        <g className="band" />
      </svg>
      {lamp && (
        <>
          <div className={styles.glow} />
          <div className={styles.fluo}>
            <svg ref={fluo}>
              <g className="field" />
              <g className="band" />
              <g className="fibres" />
            </svg>
            <div ref={rows} className={styles.rows} />
          </div>
        </>
      )}
    </div>
  );
}
