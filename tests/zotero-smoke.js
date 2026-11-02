/* Run only in a disposable Zotero profile, via a test-only bootstrap wrapper.
 * TEST_ROOT is supplied by the harness. This file is never shipped in the XPI. */
async function runWDIMSmoke() {
  const checks = [];
  function check(name, value) {
    checks.push({ name, passed: !!value });
    if (!value) throw new Error(name);
  }
  async function waitFor(fn, ms = 15000) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      if (fn()) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error("Timed out waiting for " + fn);
  }
  try {
    await Zotero.initializationPromise;
    await Zotero.Libraries.get(Zotero.Libraries.userLibraryID).waitForDataLoad("item");
    const attachment = await Zotero.Attachments.importFromFile({
      file: Zotero.File.pathToFile(TEST_ROOT + "/fixture.pdf")
    });
    const reader = await Zotero.Reader.open(attachment.id);
    await waitFor(() => reader._internalReader?._primaryView?._iframeWindow?.PDFViewerApplication?.pdfViewer?._pages?.length === 2);
    const ir = reader._internalReader;
    await ir._primaryView.initializedPromise;
    WDIM.scan();
    const doc = reader._iframeWindow.document;
    const host = reader._iframeWindow.top;
    const pdfWin = ir._primaryView._iframeWindow;
    const mouseEvents=[];
    const originalRemember=WDIM.rememberPointer;
    WDIM.rememberPointer=function(r,w,e){
      mouseEvents.push({type:e.type,trusted:e.isTrusted,detail:e.detail,sx:e.screenX,sy:e.screenY,cx:e.clientX,cy:e.clientY});
      if(mouseEvents.length>12)mouseEvents.shift();
      return originalRemember.call(this,r,w,e);
    };
    function moveMouse(x, y) {
      // Known, independent coordinates. Do not ask the production mousePoint()
      // helper for the expected value: that missed the (0,0) bug in 0.1.1.
      pdfWin.document.body.dispatchEvent(new pdfWin.MouseEvent('mousemove', Components.utils.cloneInto({
        bubbles:true, screenX:host.mozInnerScreenX+x, screenY:host.mozInnerScreenY+y
      },pdfWin)));
      check('PDF mousemove handler records specified coordinates '+JSON.stringify(mouseEvents),
        WDIM.state(reader).pointerScreen?.x===host.mozInnerScreenX+x);
    }
    moveMouse(300,350);
    check("toolbar button mounted", !!doc.querySelector('[data-wdim="toolbar"]'));
    check("reader and PDF keyboard handlers mounted", WDIM.state(reader).bindings.size >= 2);
    doc.querySelector('[data-wdim="toolbar"]').click();
    check("toolbar click arms placement", WDIM.state(reader).armed);
    doc.body.dispatchEvent(new reader._iframeWindow.KeyboardEvent('keydown',Components.utils.cloneInto({key:'Escape',bubbles:true},reader._iframeWindow)));
    check("Escape cancels placement", !WDIM.state(reader).armed);
    doc.body.dispatchEvent(new reader._iframeWindow.KeyboardEvent('keydown',Components.utils.cloneInto({code:'Slash',key:'/',metaKey:true,bubbles:true},reader._iframeWindow)));
    check("macOS shortcut arms placement", WDIM.state(reader).armed);
    WDIM.arm(reader,false);
    const anchor = { pageIndex: 0, rects: [[70, 650, 350, 670]] };
    const result = WDIM.mark(reader, anchor, true);
    check("native text question created", result.annotation.type === "text" && result.annotation.comment === "?");
    const burstDoc = reader._iframeWindow.top.document;
    const burst = burstDoc.querySelector('.wdim-burst');
    check("seven questions mounted in native window", burst?.querySelectorAll('span').length === 7);
    check("native-window burst has visible layout", burst.getBoundingClientRect().width === 180 && burst.getBoundingClientRect().height === 150);
    const firstExpectedLeft = 300 - 80 + (300 > host.innerWidth-100 ? -28 : 12);
    check("burst uses actual PDF mouse event rather than chrome helper " + JSON.stringify({
      expected:firstExpectedLeft,left:burst.getBoundingClientRect().left,styleLeft:burst.style.left,
      position:host.getComputedStyle(burst).position,display:host.getComputedStyle(burst).display,
      mouse:WDIM.state(reader).pointerScreen,point:WDIM.mousePoint(reader,host),
      screen:[host.mozInnerScreenX,host.mozInnerScreenY],size:[host.innerWidth,host.innerHeight],
      parent:burst.parentNode.localName,ns:burst.parentNode.namespaceURI,events:mouseEvents
    }), Math.abs(burst.getBoundingClientRect().left-firstExpectedLeft) < 1);
    for (const [i,[x,y]] of [[300,350],[500,450],[700,520]].entries()) {
      moveMouse(x,y);
      WDIM.burst(reader,true);
      const box=burstDoc.querySelector('.wdim-burst').getBoundingClientRect();
      const expectedLeft=x-80+(x>host.innerWidth-100?-28:12);
      const expectedTop=y-65+(y>host.innerHeight-80?-60:12);
      check('moving PDF cursor changes actual burst layout '+i,
        Math.abs(box.left-expectedLeft)<1 && Math.abs(box.top-expectedTop)<1);
    }
    host.document.documentElement.dispatchEvent(new host.MouseEvent('mousemove',Components.utils.cloneInto({
      bubbles:true,screenX:host.mozInnerScreenX+400,screenY:host.mozInnerScreenY+300
    },host)));
    WDIM.burst(reader,true);
    check('native sidebar mouse events also update burst position',
      Math.abs(burstDoc.querySelector('.wdim-burst').getBoundingClientRect().left-(400-80+(400>host.innerWidth-100?-28:12)))<1);
    for (let i = 0; i < 100; i++) WDIM.mark(reader, anchor, true);
    check("100 repeated commands coalesce", ir._annotationManager._annotations.length === 1);
    check("one animation container maximum", burstDoc.querySelectorAll('.wdim-burst').length === 1);
    check("toast is accessible", doc.querySelector('.wdim-toast')?.getAttribute('role') === 'status');
    await waitFor(() => attachment.getAnnotations().length === 1);
    const saved = attachment.getAnnotations()[0];
    check("saved to Zotero database", saved.annotationType === 'text' && saved.annotationComment === '?');
    check("no extra annotation text", !saved.annotationText);
    check("native undo available", ir.canUndo);
    ir.undo();
    check("native undo removes question immediately", ir._annotationManager._annotations.length === 0);
    // Do not wait for the asynchronous DB deletion before reapplying.
    check("reapply immediately after undo works", !WDIM.mark(reader, anchor, true).duplicate);
    await waitFor(() => attachment.getAnnotations().length === 1);
    const second = WDIM.mark(reader, { pageIndex: 1, rects: [[100,600,100,600]] });
    check("different page gets separate question", !second.duplicate);
    await waitFor(() => attachment.getAnnotations().length === 2);
    const questions = attachment.getAnnotations().map(x => ({key:x.key,type:x.annotationType,comment:x.annotationComment,position:JSON.parse(x.annotationPosition)}));
    await IOUtils.writeUTF8(TEST_ROOT + '/questions.json', JSON.stringify(questions,null,2));
    // Close and reopen to ensure deduplication survives reader destruction.
    reader.close();
    await new Promise(resolve => setTimeout(resolve, 500));
    const reopened = await Zotero.Reader.open(attachment.id);
    await waitFor(() => reopened._internalReader?._primaryView?._iframeWindow?.PDFViewerApplication?.pdfViewer?._pages?.length === 2);
    await reopened._internalReader._primaryView.initializedPromise;
    check("questions survive closing and reopening PDF", reopened._internalReader._annotationManager._annotations.length === 2);
    check("persisted questions are deduplicated", WDIM.mark(reopened,anchor,true).duplicate);
    WDIM.scan();
    const reopenedDoc=reopened._iframeWindow.document;
    WDIM.stop();
    check("disable removes all buttons", !reopenedDoc.querySelector('[data-wdim]'));
    check("disable removes all styles and overlays", !reopenedDoc.querySelector('#wdim-style,.wdim-toast,.wdim-burst'));
    check("disable removes native-window mouse burst", !reopened._iframeWindow.top.document.querySelector('.wdim-burst'));
    check("disable drops all reader references", WDIM.readers.size === 0);
    await IOUtils.writeUTF8(TEST_ROOT + '/result.json', JSON.stringify({version:Zotero.version,passed:true,checks},null,2));
  } catch (e) {
    await IOUtils.writeUTF8(TEST_ROOT + '/result.json', JSON.stringify({version:Zotero.version,passed:false,error:String(e),stack:e.stack,checks},null,2));
  } finally {
    Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);
  }
}
