// Patches the page instead of replacing it, so focus, hover, scroll and animations survive
// Kept small, the markup comes from one template so children line up by position

// Never copy these blindly, they hold what the player typed or where they scrolled
const isFormField = (el) => el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;

function syncAttributes(from, to) {
  const fromAttrs = from.attributes;
  for (let i = fromAttrs.length - 1; i >= 0; i--) {
    const name = fromAttrs[i].name;
    if (!to.hasAttribute(name)) from.removeAttribute(name);
  }
  for (const { name, value } of to.attributes) {
    if (from.getAttribute(name) !== value) from.setAttribute(name, value);
  }
}

function syncFormField(from, to) {
  // Never overwrite what the player is typing, anything else the game sets still lands
  const focused = document.activeElement === from;
  if (!focused && to.hasAttribute("value") && from.value !== to.getAttribute("value")) {
    from.value = to.getAttribute("value");
  }
  from.checked = to.hasAttribute("checked") || to.checked;
  from.disabled = to.hasAttribute("disabled");
  if (to.hasAttribute("readonly") !== from.readOnly) from.readOnly = to.hasAttribute("readonly");
}

function compatible(a, b) {
  if (a.nodeType !== b.nodeType) return false;
  if (a.nodeType !== Node.ELEMENT_NODE) return true;
  if (a.tagName !== b.tagName) return false;
  // Elements with an ID are never morphed into a different element
  const aId = a.getAttribute("id");
  const bId = b.getAttribute("id");
  return !aId && !bId ? true : aId === bId;
}

function morphNode(from, to) {
  if (from.nodeType === Node.TEXT_NODE || from.nodeType === Node.COMMENT_NODE) {
    if (from.nodeValue !== to.nodeValue) from.nodeValue = to.nodeValue;
    return;
  }
  if (from.nodeType !== Node.ELEMENT_NODE) return;
  syncAttributes(from, to);
  if (isFormField(from)) {
    syncFormField(from, to);
    return; // Form fields have no children worth going through
  }
  morphChildren(from, to);
}

function morphChildren(from, to) {
  let a = from.firstChild;
  let b = to.firstChild;
  while (b) {
    const nextB = b.nextSibling;
    if (!a) {
      from.appendChild(b.cloneNode(true));
      b = nextB;
      continue;
    }
    const nextA = a.nextSibling;
    if (compatible(a, b)) {
      morphNode(a, b);
    } else {
      from.replaceChild(b.cloneNode(true), a);
    }
    a = nextA;
    b = nextB;
  }
  while (a) {
    const nextA = a.nextSibling;
    from.removeChild(a);
    a = nextA;
  }
}

export function morph(root, html) {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  morphChildren(root, tpl.content);
}
