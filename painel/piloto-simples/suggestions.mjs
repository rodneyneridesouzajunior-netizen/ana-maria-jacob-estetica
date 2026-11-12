// Sugestões de preenchimento: campos de texto repetitivos passam a sugerir valores já usados na clínica.
// Só sugere (datalist); nada é preenchido ou salvo automaticamente. Funciona em qualquer formulário do app.
export const SUGGESTED_FIELDS = Object.freeze(['description', 'category', 'supplier', 'brand', 'reason', 'service', 'extraReason', 'label', 'title', 'unit', 'method']);
const MAX = 60;
const LIST_PREFIX = 'amj-sugestoes-';

/** Valores de texto já usados para um campo, mais recentes primeiro, sem repetição. */
export function collectSuggestions(state, field, max = MAX) {
  const seen = new Map();
  const visit = (value, depth) => {
    if (!value || depth > 3 || seen.size >= 5000) return;
    if (Array.isArray(value)) { for (let i = value.length - 1; i >= 0; i--) visit(value[i], depth + 1); return; }
    if (typeof value !== 'object') return;
    const text = value[field];
    if (typeof text === 'string') {
      const clean = text.trim();
      const key = clean.toLocaleLowerCase('pt-BR');
      if (clean.length >= 2 && clean.length <= 120 && !seen.has(key)) seen.set(key, clean);
    }
    for (const [key, child] of Object.entries(value)) if (child && typeof child === 'object' && !['photos', 'auditLog', 'recycleBin', 'documentHistory'].includes(key)) visit(child, depth + 1);
  };
  visit(state, 0);
  return [...seen.values()].slice(0, max);
}

/** Liga as sugestões aos campos que aparecerem na tela. Retorna função para desligar. */
export function installSuggestions(getState, root = globalThis.document) {
  if (!root?.body || !root.defaultView?.MutationObserver) return () => {};
  const lists = new Map();
  const listFor = field => {
    let list = lists.get(field);
    if (!list || !list.isConnected) {
      list = root.getElementById?.(LIST_PREFIX + field) || root.createElement('datalist');
      list.id = LIST_PREFIX + field;
      if (!list.isConnected) root.body.append(list);
      lists.set(field, list);
    }
    return list;
  };
  const attach = input => {
    if (!(input instanceof root.defaultView.HTMLInputElement)) return;
    if (input.type && !['text', 'search', ''].includes(input.type)) return;
    if (!SUGGESTED_FIELDS.includes(input.name) || input.hasAttribute('list') || input.readOnly) return;
    input.setAttribute('list', LIST_PREFIX + input.name);
    input.setAttribute('autocomplete', 'off');
    input.addEventListener('focus', () => {
      const state = getState();
      if (!state) return;
      const list = listFor(input.name);
      list.replaceChildren(...collectSuggestions(state, input.name).map(value => Object.assign(root.createElement('option'), {value})));
    });
  };
  const scan = node => {
    if (node.nodeType !== 1) return;
    if (node.matches?.('input[name]')) attach(node);
    node.querySelectorAll?.('input[name]').forEach(attach);
  };
  scan(root.body);
  const observer = new root.defaultView.MutationObserver(records => { for (const r of records) r.addedNodes.forEach(scan); });
  observer.observe(root.body, {childList: true, subtree: true});
  return () => observer.disconnect();
}
