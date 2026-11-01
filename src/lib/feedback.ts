import { renderIcon, type IconName } from './icons';
type MessageKind = 'success' | 'error' | 'info' | 'warning';
const escape = (value: string) => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
export function feedbackIcon(name: IconName = 'info') { return renderIcon(name); }
export function emptyState(title: string, description: string, icon: IconName = 'court') {
  return `<div class="feedback-empty"><span class="feedback-empty-icon">${feedbackIcon(icon)}</span><h3>${escape(title)}</h3><p>${escape(description)}</p></div>`;
}

let toastTimer: ReturnType<typeof setTimeout>;
export function notify(message: string, kind: string = 'info') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  const type: MessageKind = ['success','error','warning'].includes(kind) ? kind as MessageKind : 'info';
  const title = {success:'All set',error:'Unable to complete',warning:'Heads up',info:'Court update'}[type];
  clearTimeout(toastTimer);
  toast.className = `toast show ${type}`;
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
  toast.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
  toast.setAttribute('aria-atomic', 'true');
  toast.innerHTML = `<span class="feedback-toast-icon">${feedbackIcon(type)}</span><div class="feedback-toast-copy"><strong>${title}</strong><p>${escape(message)}</p></div><button class="feedback-dismiss" type="button" aria-label="Dismiss notification">${feedbackIcon('error')}</button>`;
  const dismiss = () => { clearTimeout(toastTimer); toast.classList.remove('show'); };
  const schedule = () => { clearTimeout(toastTimer); toastTimer = setTimeout(dismiss, type === 'error' ? 9000 : 4500); };
  const closeButton = toast.querySelector('button');
  closeButton.onclick = dismiss;
  toast.onmouseenter = () => clearTimeout(toastTimer);
  toast.onmouseleave = schedule;
  closeButton.onfocus = () => clearTimeout(toastTimer);
  closeButton.onblur = schedule;
  schedule();
}

let approvedMessage: string | null = null;
let confirmationOpen = false;
/** Keep synchronous business functions intact; replay only after explicit acceptance.
 * The freshly loaded state recomputes the message, so a changed proposal asks again.
 */
export function confirmAction(message: string, action: () => unknown): boolean {
  if (approvedMessage === message) { approvedMessage = null; return true; }
  if (typeof document === 'undefined' || !document.createElement) return confirm(message);
  if (confirmationOpen) return false;
  const dialog = document.createElement('dialog');
  if (!dialog.showModal) return confirm(message);
  const destructive = /remove|delete|reset|cancel the current|replace all/i.test(message);
  const title = /Check in all/.test(message) ? 'Check everyone in?' : /Reset session attendance/.test(message) ? 'Reset session attendance?' : /Confirm current attendance/.test(message) ? 'Confirm attendance?' : /Remove fixed partnership/.test(message) ? 'Remove this fixed pair?' : /Record /.test(message) ? 'Save this result?' : /End this session/.test(message) ? 'Finish this session?' : /Remove player/.test(message) ? 'Remove this player?' : /Cancel the current/.test(message) ? 'Cancel this game?' : /delete ALL data/i.test(message) ? 'Delete all saved data?' : /delete all past/i.test(message) ? 'Clear session history?' : /Reset this match/.test(message) ? 'Reset this match?' : /replace all current/i.test(message) ? 'Replace your saved data?' : 'Update the lineup?';
  const label = /Check in all/.test(message) ? 'Check In All' : /Reset session attendance/.test(message) ? 'Reset attendance' : /Confirm current attendance/.test(message) ? 'Confirm attendance' : /Remove fixed partnership/.test(message) ? 'Remove pair' : /Record /.test(message) ? 'Save result' : /End this session/.test(message) ? 'End session' : /Remove player/.test(message) ? 'Remove player' : /Cancel the current/.test(message) ? 'Cancel game' : /delete ALL data/i.test(message) ? 'Delete all data' : /delete all past/i.test(message) ? 'Clear history' : /Reset this match/.test(message) ? 'Reset match' : /replace all current/i.test(message) ? 'Import backup' : 'Use new lineup';
  dialog.className = `feedback-confirm ${destructive ? 'is-destructive' : ''}`;
  dialog.setAttribute('aria-labelledby','feedbackConfirmTitle');
  dialog.setAttribute('aria-describedby','feedbackConfirmDescription');
  dialog.innerHTML = `<div class="feedback-confirm-accent"></div><div class="feedback-confirm-body"><span class="feedback-empty-icon">${feedbackIcon(destructive ? 'warning' : 'success')}</span><p class="feedback-eyebrow">${destructive ? 'PLEASE REVIEW' : 'ONE LAST CHECK'}</p><h2 id="feedbackConfirmTitle">${title}</h2><p id="feedbackConfirmDescription">${escape(message)}</p></div><div class="feedback-confirm-actions"><button type="button" class="feedback-cancel" autofocus>Keep as is</button><button type="button" class="feedback-accept">${label}</button></div>`;
  const previousFocus = document.activeElement as HTMLElement;
  confirmationOpen = true;
  document.body.appendChild(dialog);
  let accepted = false;
  dialog.querySelector<HTMLButtonElement>('.feedback-cancel').onclick = () => dialog.close();
  dialog.querySelector<HTMLButtonElement>('.feedback-accept').onclick = () => { accepted = true; dialog.close(); };
  dialog.onclick = event => { if (event.target === dialog) { const r=dialog.getBoundingClientRect(); if(event.clientX<r.left || event.clientX>r.right || event.clientY<r.top || event.clientY>r.bottom) dialog.close(); } };
  dialog.onclose = () => {
    confirmationOpen = false;
    dialog.remove();
    if (previousFocus?.isConnected) previousFocus.focus();
    if (!accepted) return;
    approvedMessage = message;
    try { Promise.resolve(action()).catch(error => notify(error.message,'error')).finally(() => { approvedMessage = null; }); }
    catch(error) { approvedMessage = null; notify(error.message,'error'); }
  };
  dialog.showModal();
  return false;
}
