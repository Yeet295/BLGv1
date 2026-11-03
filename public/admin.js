const app = document.getElementById('app');

function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  Object.assign(e, props);
  kids.flat().forEach((k) => e.append(k));
  return e;
}
async function api(url, method = 'GET', data) {
  const r = await fetch(url, {
    method,
    headers: data ? { 'Content-Type': 'application/json' } : {},
    body: data ? JSON.stringify(data) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Request failed');
  return j;
}

function loginView() {
  const err = h('div', { className: 'err' });
  const pw = h('input', { type: 'password', placeholder: 'Admin password', autofocus: true });
  const go = async (e) => {
    e.preventDefault();
    try { await api('/api/login', 'POST', { password: pw.value }); start(); }
    catch (x) { err.textContent = x.message; }
  };
  app.replaceChildren(h('form', { className: 'card', onsubmit: go },
    h('h2', { textContent: 'Admin login' }), pw, err, h('button', { className: 'btn', textContent: 'Log in' })));
}

async function panel() {
  const posts = await api('/api/posts');
  const idBox = h('input', { type: 'hidden' });
  const title = h('input', { placeholder: 'Title', maxLength: 200 });
  const body = h('textarea', { placeholder: 'Write your post…' });
  const err = h('div', { className: 'err' });
  const heading = h('h2', { textContent: 'New post' });

  const reset = () => { idBox.value = title.value = body.value = ''; heading.textContent = 'New post'; err.textContent = ''; };
  const save = async (e) => {
    e.preventDefault();
    try {
      const data = { title: title.value, body: body.value };
      idBox.value ? await api('/api/posts/' + idBox.value, 'PUT', data) : await api('/api/posts', 'POST', data);
      panel();
    } catch (x) { err.textContent = x.message; }
  };

  const form = h('form', { className: 'card', onsubmit: save }, heading, idBox, title, body, err,
    h('div', { className: 'row' },
      h('div', {}, h('button', { className: 'btn', textContent: 'Save' }), ' ',
        h('button', { type: 'button', className: 'btn alt', textContent: 'Clear', onclick: reset })),
      h('button', { type: 'button', className: 'btn alt', textContent: 'Log out',
        onclick: async () => { await api('/api/logout', 'POST'); start(); } })));

  const list = posts.map((p) => h('div', { className: 'card row' },
    h('div', {}, h('strong', { textContent: p.title }),
      h('div', { className: 'small', textContent: p.votes ? `${p.avg} / 5 · ${p.votes} votes` : 'No ratings yet' })),
    h('div', {},
      h('button', { className: 'btn alt', textContent: 'Edit', onclick: () => {
        idBox.value = p.id; title.value = p.title; body.value = p.body;
        heading.textContent = 'Editing post'; scrollTo(0, 0);
      } }), ' ',
      h('button', { className: 'btn del', textContent: 'Delete', onclick: async () => {
        if (confirm(`Delete "${p.title}"? This also removes its ratings.`)) { await api('/api/posts/' + p.id, 'DELETE'); panel(); }
      } }))));

  app.replaceChildren(form, h('h2', { textContent: 'All posts' }), ...list);
}

async function start() {
  const me = await api('/api/me');
  me.admin ? panel() : loginView();
}
start();
