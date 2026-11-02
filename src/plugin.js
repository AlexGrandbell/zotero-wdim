/* SPDX-License-Identifier: MIT */
/* global Zotero, WDIMCore */
var WDIMBurstCSS = `
  .wdim-burst {position:fixed;width:180px;height:150px;z-index:2147483645;
    pointer-events:none;contain:layout style;}
  .wdim-burst span {position:absolute;left:80px;top:65px;color:#e56b35;
    font:900 38px/1 ui-rounded,system-ui,sans-serif;text-shadow:0 2px 0 #fff8;
    animation:wdim-pop 800ms cubic-bezier(.16,.8,.24,1) both;}
  @keyframes wdim-pop {0%{transform:translate(0,15px) scale(.2) rotate(-20deg);opacity:0}
    20%{opacity:1}65%{opacity:1}100%{transform:translate(var(--x),var(--y)) scale(.7) rotate(var(--r));opacity:0}}
  @media(prefers-reduced-motion:reduce){.wdim-burst{display:none}}
`;
var WDIMPlugin = class {
  constructor(zotero, rootURI) {
    this.z = zotero;
    this.rootURI = rootURI;
    this.id = "wdim@zoterowdim.local";
    this.readers = new Map();
    this.events = [];
    this.timer = null;
    this.running = false;
  }

  async start() {
    this.running = true;
    for (const type of ["renderToolbar", "renderTextSelectionPopup"]) {
      const handler = event => {
        try { this.render(type, event); }
        catch (error) { this.z.logError(error); }
      };
      this.z.Reader.registerEventListener(type, handler, this.id);
      this.events.push([type, handler]);
    }
    // Plugins initialize before uiReadyPromise resolves. Never block startup on it.
    this.z.uiReadyPromise.then(() => {
      if (!this.running) return;
      this.scan();
      // Covers already-open PDFs, newly opened readers, and later-created split views.
      this.timer = setInterval(() => this.scan(), 800);
    }).catch(error => this.z.logError(error));
  }

  internal(reader) { return reader?._internalReader; }

  inReaderRealm(reader, value) {
    // Reader internals live in an unprivileged iframe. Give them their own objects,
    // rather than privileged bootstrap objects that content scripts cannot read.
    return reader._iframeWindow
      ? Components.utils.cloneInto(value, reader._iframeWindow)
      : value;
  }

  state(reader) {
    if (!this.readers.has(reader)) {
      this.readers.set(reader, {
        bindings: new Map(), docs: new Set(), buttons: new Set(),
        armed: false, lastBurst: 0, pointerScreen: null, removers: new Set()
      });
    }
    return this.readers.get(reader);
  }

  scan() {
    if (!this.running) return;
    const live = new Set(this.z.Reader._readers);
    for (const [reader, state] of this.readers) {
      if (!live.has(reader)) {
        this.dispose(state);
        this.readers.delete(reader);
      }
    }
    for (const reader of live) {
      if (reader._type !== "pdf") continue;
      try {
        const ir = this.internal(reader);
        const win = reader._iframeWindow;
        if (!ir || !win?.document?.body) continue;
        const state = this.state(reader);
        this.style(win.document, state);
        this.bind(reader, win, null);
        if (win.top && win.top !== win) this.bind(reader, win.top, null, true);
        // renderToolbar has already fired when enabling a plugin on an open PDF.
        const toolbar = win.document.querySelector(".toolbar .custom-sections");
        if (toolbar && !win.document.querySelector('[data-wdim="toolbar"]')) {
          toolbar.append(this.button(reader, win.document, "toolbar"));
        }
        for (const view of [ir._primaryView, ir._secondaryView]) {
          const pdfWin = view?._iframeWindow;
          if (pdfWin?.document?.body) {
            this.style(pdfWin.document, state);
            this.bind(reader, pdfWin, view);
          }
        }
        // A closed split pane must not retain its detached window.
        for (const [w, binding] of state.bindings) {
          let dead;
          try { dead = w.closed || (binding.view && binding.view !== ir._primaryView && binding.view !== ir._secondaryView); }
          catch (_) { dead = true; }
          if (dead) {
            binding.remove();
            state.bindings.delete(w);
            state.docs.delete(binding.doc);
          }
        }
        for (const button of state.buttons) {
          try { if (!button.isConnected) state.buttons.delete(button); }
          catch (_) { state.buttons.delete(button); }
        }
      }
      catch (error) { this.z.debug("WDIM: reader is not ready: " + error); }
    }
  }

  render(type, { reader, doc, params, append }) {
    if (!this.running || reader._type !== "pdf") return;
    this.style(doc, this.state(reader));
    if (type === "renderToolbar") append(this.button(reader, doc, "toolbar"));
    else if (params.annotation?.position) {
      // Copy while the popup is alive; later renders can mutate reader state.
      const selection = JSON.parse(JSON.stringify(params.annotation));
      append(this.button(reader, doc, "selection", selection));
    }
  }

  button(reader, doc, kind, selection) {
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "toolbar-button wdim-button";
    button.dataset.wdim = kind;
    button.textContent = "?";
    button.setAttribute("aria-label", "和意为：留下一个问号");
    const state = this.state(reader);
    state.buttons.add(button);
    // Preserve the PDF selection, while retaining normal keyboard button activation.
    button.addEventListener("mousedown", e => e.preventDefault());
    button.addEventListener("click", event => {
      if (event.detail) this.rememberPointer(reader, doc.defaultView, event);
      this.perform(reader, () => selection ? this.mark(reader, selection.position, true) : this.activate(reader));
    });
    this.update(reader);
    return button;
  }

  bind(reader, win, view, trackingOnly = false) {
    const state = this.state(reader);
    if (state.bindings.has(win)) return;
    const key = event => {
      if (trackingOnly) return;
      if (event.key === "Escape" && state.armed) {
        this.arm(reader, false);
        return;
      }
      if (!WDIMCore.isShortcut(event, this.z.isMac) || WDIMCore.isEditable(event.target)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat) return;
      this.perform(reader, () => this.activate(reader, false, view));
    };
    const pointer = event => {
      this.rememberPointer(reader, win, event);
      if (trackingOnly) return;
      if (!view || !state.armed || event.button !== 0 || WDIMCore.isEditable(event.target)) return;
      // Compatibility adapter: Zotero has no public API for PDF click coordinates yet.
      const anchor = view.pointerEventToPosition(event);
      if (!anchor) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.perform(reader, () => this.mark(reader, anchor, false, view));
    };
    const move = event => this.rememberPointer(reader, win, event);
    win.addEventListener("keydown", key, true);
    win.addEventListener("pointerdown", pointer, true);
    win.addEventListener("pointermove", move, true);
    // Listen to ordinary mouse events too: chrome windows and some reader
    // surfaces do not consistently deliver the PointerEvent stream.
    win.addEventListener("mousemove", move, true);
    win.addEventListener("mousedown", move, true);
    const remove = () => {
      // Firefox turns destroyed iframe wrappers into "dead objects".
      try { win.removeEventListener("keydown", key, true); } catch (_) {}
      try { win.removeEventListener("pointerdown", pointer, true); } catch (_) {}
      try { win.removeEventListener("pointermove", move, true); } catch (_) {}
      try { win.removeEventListener("mousemove", move, true); } catch (_) {}
      try { win.removeEventListener("mousedown", move, true); } catch (_) {}
    };
    state.bindings.set(win, { view, remove, doc: win.document });
    this.update(reader);
  }

  rememberPointer(reader, win, event) {
    if (event.pointerType === "touch") return;
    if (Number.isFinite(event.screenX) && Number.isFinite(event.screenY)) {
      // Screen coordinates share one CSS-pixel space across the nested PDF frames.
      // Retain only numbers, never the event or its soon-to-be-destroyed window.
      this.state(reader).pointerScreen = { x: event.screenX, y: event.screenY };
    }
  }

  mousePoint(reader, surface) {
    const win = reader._iframeWindow;
    let screen = this.state(reader).pointerScreen;
    if (!screen) try {
      // Also handles a keyboard trigger before any pointer event reaches the plugin,
      // and a cursor resting over another pane of the same native window.
      const host = win.top;
      const x = {}, y = {};
      host.windowUtils.getLastOverWindowPointerLocationInCSSPixels(x, y);
      // Gecko reports (0,0) when this chrome PresShell has never seen a mouse.
      // That is not evidence of a cursor at the upper-left corner. In particular,
      // never overwrite the real event coordinates from a nested PDF iframe.
      if (Number.isFinite(x.value) && Number.isFinite(y.value) && (x.value !== 0 || y.value !== 0)) {
        screen = { x: x.value + host.mozInnerScreenX, y: y.value + host.mozInnerScreenY };
      }
    } catch (_) { /* Pointer-event coordinates cover runtimes without this helper. */ }
    if (!screen) return null;
    const origin = surface || win;
    return { x: screen.x - origin.mozInnerScreenX, y: screen.y - origin.mozInnerScreenY };
  }

  perform(reader, fn) {
    try { return fn(); }
    catch (error) {
      this.arm(reader, false);
      this.z.logError(error);
      this.toast(reader, "问号没落地：" + error.message, true);
      return null;
    }
  }

  activate(reader, toggle = true, preferredView) {
    const ir = this.internal(reader);
    if (!this.editable(reader)) {
      this.toast(reader, "这里暂时不能留批注，问号先憋住。", true);
      return;
    }
    const view = preferredView || ir._lastView || ir._primaryView;
    // Use the current view only; never reuse a stale selection from another page.
    const selection = view?._selectionRanges;
    if (selection?.length && !selection[0].collapsed) {
      const annotation = view._getAnnotationFromSelectionRanges(selection, "highlight");
      if (annotation?.position) return this.mark(reader, annotation.position, true, view);
    }
    this.arm(reader, toggle ? !this.state(reader).armed : true);
    if (this.state(reader).armed) {
      this.burst(reader, false);
      this.toast(reader, "和意为？点一下论文，放下问号。Esc 取消");
    }
  }

  editable(reader) {
    const attachment = this.z.Items.get(reader.itemID);
    return !!attachment?.isEditable() && !this.internal(reader)?._state?.readOnly;
  }

  arm(reader, armed) {
    const state = this.state(reader);
    state.armed = armed;
    this.update(reader);
  }

  update(reader) {
    const state = this.state(reader);
    for (const button of state.buttons) {
      try {
        button.setAttribute("aria-pressed", String(state.armed));
        button.title = state.armed ? "点击论文放下问号 · Esc 取消" : "和意为？留下一个问号 · ⌘/";
      } catch (_) { state.buttons.delete(button); }
    }
    for (const doc of state.docs) {
      try { doc.documentElement.classList.toggle("wdim-armed", state.armed); }
      catch (_) { state.docs.delete(doc); }
    }
  }

  mark(reader, anchor, fromSelection = false, preferredView) {
    if (!this.editable(reader)) {
      this.arm(reader, false);
      this.toast(reader, "只读论文：问号暂时无法落笔。", true);
      return null;
    }
    const ir = this.internal(reader);
    // For a two-page text selection, anchor the question at its actual end.
    anchor = JSON.parse(JSON.stringify(anchor));
    if (fromSelection && anchor.nextPageRects?.length) {
      anchor = { pageIndex: anchor.pageIndex + 1, rects: anchor.nextPageRects };
    }
    const view = preferredView || ir._lastView || ir._primaryView;
    const pdfPage = view?._iframeWindow?.PDFViewerApplication?.pdfViewer?._pages?.[anchor.pageIndex];
    const position = WDIMCore.makePosition(anchor, pdfPage?.viewport?.viewBox, fromSelection);
    const manager = ir._annotationManager;
    if (!manager?.addAnnotation || !view?.getAnnotationMeta) {
      throw new Error("此 Zotero 版本的 PDF 接口尚未适配");
    }
    // Include unsaved annotations from every window displaying this attachment.
    // addAnnotation mutates the manager synchronously, eliminating repeated-key races.
    const candidates = [];
    for (const other of this.z.Reader._readers) {
      if (other.itemID === reader.itemID) {
        candidates.push(...(this.internal(other)?._annotationManager?._annotations || []));
      }
    }
    // The manager contains persisted annotations as well. Do not fall back to the
    // database here: native undo/delete can precede its asynchronous database commit.
    const existing = candidates.find(a => WDIMCore.sameQuestion(a, position));
    this.arm(reader, false);
    if (existing) {
      this.burst(reader, true);
      this.toast(reader, "疑惑可以很多，问号只留一个。");
      return { duplicate: true, annotation: existing };
    }
    const meta = view.getAnnotationMeta(this.inReaderRealm(reader, position));
    const annotation = manager.addAnnotation(this.inReaderRealm(reader, {
      type: "text", comment: "?", color: WDIMCore.COLOR,
      position, sortIndex: meta.sortIndex, pageLabel: meta.pageLabel
    }));
    if (!annotation) throw new Error("批注未被接受，请检查编辑权限");
    this.burst(reader, false);
    this.toast(reader, "问号已落笔，理解稍后到。");
    return { duplicate: false, annotation };
  }

  style(doc, state) {
    state.docs.add(doc);
    if (doc.getElementById("wdim-style")) return;
    const style = doc.createElement("style");
    style.id = "wdim-style";
    style.textContent = `
      .wdim-button { display:inline-flex!important; align-items:center; justify-content:center;
        min-width:28px; height:28px; padding:2px 8px!important; margin:0 3px;
        font:800 22px/1 ui-rounded,system-ui,sans-serif!important; color:#b9471b!important;
        border:1px solid #e56b354d!important; border-radius:9px!important;
        background:#e56b3514!important; cursor:pointer; }
      .wdim-button:hover,.wdim-button[aria-pressed="true"] {background:#e56b3533!important;}
      .wdim-button:focus-visible {outline:2px solid #e56b35;outline-offset:2px;}
      .wdim-armed .pdfViewer,.wdim-armed .pdfViewer * {cursor:crosshair!important;}
      .wdim-toast {position:fixed;z-index:2147483646;bottom:28px;left:50%;transform:translateX(-50%);
        max-width:calc(100vw - 48px);box-sizing:border-box;padding:11px 18px;border-radius:14px;
        background:#27231f;color:#fff9ef;box-shadow:0 6px 30px #0003;
        font:500 13px/1.5 system-ui,sans-serif;pointer-events:none;text-align:center;}
      ${WDIMBurstCSS}
      @media(prefers-color-scheme:dark){.wdim-button{color:#ffab7e!important}}
      @media(prefers-reduced-motion:reduce){.wdim-burst{display:none}}
    `;
    (doc.head || doc.documentElement).append(style);
  }

  toast(reader, text, error = false) {
    const state = this.state(reader);
    const doc = reader._iframeWindow?.document;
    if (!doc?.body) return;
    doc.querySelector(".wdim-toast")?._wdimRemove?.();
    const node = doc.createElement("div");
    node.className = "wdim-toast";
    node.setAttribute("role", error ? "alert" : "status");
    node.textContent = text;
    doc.body.append(node);
    this.temporary(state, node, 2600);
  }

  burst(reader, duplicate) {
    const state = this.state(reader);
    const now = Date.now();
    const readerWin = reader._iframeWindow;
    // Render in the native window, so a cursor over a sidebar is not clipped by
    // the PDF iframe. Explicit HTML namespaces also work in Zotero's XUL window.
    const win = readerWin?.top || readerWin;
    const doc = win?.document;
    const parent = doc?.body || doc?.documentElement;
    if (!parent || win.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const point = this.mousePoint(reader, win);
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
    // Keep the origin beside the cursor. Fan inward at viewport edges instead of
    // moving the entire effect to a fixed corner or clipping most of its questions.
    const flipX = point.x > win.innerWidth - 100 ? -1 : point.x < 100 ? 1 : 0;
    const flipY = point.y < 110 ? 1 : point.y > win.innerHeight - 80 ? -1 : 0;
    const left = point.x - 80 + (flipX === -1 ? -28 : 12);
    const top = point.y - 65 + (flipY === -1 ? -60 : 12);
    const old = doc.querySelector(".wdim-burst");
    if (old && now - state.lastBurst < 250) {
      old.style.left = `${left}px`;
      old.style.top = `${top}px`;
      for (const q of old.querySelectorAll("span")) {
        q.style.setProperty("--x", `${flipX ? Math.abs(Number(q.dataset.x)) * flipX : q.dataset.x}px`);
        q.style.setProperty("--y", `${flipY ? Math.abs(Number(q.dataset.y)) * flipY : q.dataset.y}px`);
      }
      return;
    }
    state.lastBurst = now;
    // One burst at a time, even when repeatedly tapping the shortcut.
    old?._wdimRemove?.();
    const html = name => doc.createElementNS("http://www.w3.org/1999/xhtml", name);
    const node = html("div");
    node.className = "wdim-burst";
    node.style.left = `${left}px`;
    node.style.top = `${top}px`;
    node.setAttribute("aria-hidden", "true");
    const style = html("style");
    style.textContent = WDIMBurstCSS;
    node.append(style);
    const offsets = [[-64,-27,-25],[-40,-66,-12],[0,-78,8],[38,-58,24],[62,-20,35],[-25,8,-8],[30,10,14]];
    for (const [i, [x,y,r]] of offsets.entries()) {
      const q = html("span");
      q.textContent = "?";
      q.dataset.x = String(x);
      q.dataset.y = String(y);
      q.style.cssText = `--x:${flipX ? Math.abs(x) * flipX : x}px;--y:${flipY ? Math.abs(y) * flipY : y}px;--r:${r}deg;animation-delay:${i*35}ms;font-size:${duplicate ? 30 : 38}px`;
      node.append(q);
    }
    parent.append(node);
    this.temporary(state, node, 1150);
  }

  temporary(state, node, ms) {
    const timer = setTimeout(() => remove(), ms);
    const remove = () => {
      clearTimeout(timer);
      try { node.remove(); } catch (_) { /* Its iframe may already be destroyed. */ }
      state.removers.delete(remove);
    };
    node._wdimRemove = remove;
    state.removers.add(remove);
  }

  dispose(state) {
    for (const binding of state.bindings.values()) binding.remove();
    for (const remove of [...state.removers]) remove();
    for (const button of state.buttons) { try { button.remove(); } catch (_) {} }
    for (const doc of state.docs) {
      try {
        doc.getElementById("wdim-style")?.remove();
        doc.documentElement.classList.remove("wdim-armed");
      } catch (_) { /* Closed PDF iframe: release the reference below. */ }
    }
    state.bindings.clear(); state.docs.clear(); state.buttons.clear();
  }

  stop() {
    this.running = false;
    clearInterval(this.timer);
    for (const [type, handler] of this.events) this.z.Reader.unregisterEventListener(type, handler);
    for (const state of this.readers.values()) this.dispose(state);
    this.events = [];
    this.readers.clear();
  }
};
