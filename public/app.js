const app = document.getElementById('app');

function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  Object.assign(e, props);
  kids.flat().forEach((k) => e.append(k));
  return e;
}
const date = (s) => new Date(s).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
async function api(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Request failed');
  return r.json();
}

function stars(post, onChange) {
  const box = h('div', { className: 'stars' });
  const info = h('span', { className: 'small' });
  const draw = (p) => {
    box.replaceChildren(...[1, 2, 3, 4, 5].map((n) =>
      h('button', {
        textContent: '★', title: `${n} star${n > 1 ? 's' : ''}`,
        className: n <= (p.mine || 0) ? 'on' : '',
        onclick: async () => { p = await api(`/api/posts/${p.id}/rate`, jsonBody({ stars: n })); draw(p); onChange && onChange(p); },
      })), info);
    info.textContent = p.votes ? ` ${p.avg} / 5 (${p.votes} vote${p.votes > 1 ? 's' : ''})` : ' No ratings yet';
  };
  draw(post);
  return box;
}
const jsonBody = (o) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o) });

async function showList() {
  document.title = 'My Blog';
  const posts = await api('/api/posts');
  app.replaceChildren(...(posts.length ? posts.map((p) =>
    h('article', { className: 'card' },
      h('h2', {}, h('a', { href: `#/post/${p.id}`, textContent: p.title })),
      h('div', { className: 'small', textContent: date(p.created_at) }),
      h('p', { textContent: p.body.length > 220 ? p.body.slice(0, 220) + '…' : p.body }),
      stars(p))) : [h('p', { className: 'small', textContent: 'No posts yet.' })]));
}

async function showPost(id) {
  try {
    const p = await api('/api/posts/' + id);
    document.title = p.title;
    app.replaceChildren(
      h('a', { href: '#/', className: 'small', textContent: '← All posts' }),
      h('h1', { textContent: p.title }),
      h('div', { className: 'small', textContent: date(p.created_at) }),
      h('div', { className: 'body', textContent: p.body }),
      h('div', { className: 'card' }, h('div', { textContent: 'Rate this post:' }), stars(p)));
  } catch { app.replaceChildren(h('p', { textContent: 'Post not found.' })); }
}

function route() {
  const m = location.hash.match(/^#\/post\/(\d+)$/);
  m ? showPost(m[1]) : showList();
}
addEventListener('hashchange', route);
route();
