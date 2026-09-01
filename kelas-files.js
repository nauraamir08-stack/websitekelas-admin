'use strict';
(() => {
  const root = document.getElementById('filesPage');
  const config = window.SUPABASE_CONFIG;
  const api = window.supabase;
  if (!root || !api?.createClient || !config?.url) return;
  const client = api.createClient(config.url, config.publishableKey);
  let courses = [];
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));

  function passwordToggle(button) {
    button.onclick = () => {
      const input = button.closest('.password-field').querySelector('input');
      input.type = input.type === 'password' ? 'text' : 'password';
      button.textContent = input.type === 'password' ? '👁️' : '🙈';
    };
  }
  function login(message = '') {
    root.innerHTML = `<section class="hero"><span class="eyebrow">AREA ADMIN</span><h1>File mata kuliah.</h1><p>Unggah RPS, materi, kontrak kuliah, atau berkas lainnya.</p></section><section class="panel admin-auth-card"><div class="panel-heading"><div><h2>Masuk admin</h2><p>Gunakan akun pengelola.</p></div></div>${message ? `<p class="form-message form-message-error">${esc(message)}</p>` : ''}<form id="fileLogin" class="admin-form"><label><span class="field-label">Email</span><input class="text-field" name="email" type="email" required></label><label><span class="field-label">Kata sandi</span><span class="password-field"><input class="text-field" name="password" type="password" required><button class="password-toggle" type="button">👁️</button></span></label><button class="button button-primary">Masuk →</button></form></section>`;
    const form = root.querySelector('#fileLogin'); passwordToggle(form.querySelector('.password-toggle'));
    form.onsubmit = async event => { event.preventDefault(); const { error } = await client.auth.signInWithPassword({ email: form.elements.email.value.trim(), password: form.elements.password.value }); if (error) return login('Email atau kata sandi tidak sesuai.'); render(); };
  }
  function fileGroups(files) {
    return courses.map(course => ({ course, items: files.filter(file => file.course_id === course.id) })).filter(group => group.items.length).map(({ course, items }) => `<article class="admin-file-course"><div class="admin-file-course-heading"><span class="badge badge-individu">📁 ${items.length} file</span><h3>${esc(course.name)}</h3></div><div class="admin-task-list">${items.map(file => `<article class="admin-task-item"><div><h3>${esc(file.name)}</h3><p>${esc(file.file_name)}</p></div><div class="admin-task-actions"><a class="button button-secondary" href="${esc(file.file_url)}" target="_blank" rel="noopener">Buka</a><button class="button button-danger" type="button" data-delete-file="${esc(file.id)}">Hapus</button></div></article>`).join('')}</div></article>`).join('');
  }
  async function render() {
    const { data: access, error } = await client.from('course_admins').select('course_id');
    if (error || !access?.length) return login('Akun ini belum terhubung ke mata kuliah.');
    const allowed = new Set(access.map(row => row.course_id));
    const { data: allCourses } = await client.from('courses').select('id,name').order('name');
    courses = (allCourses || []).filter(course => allowed.has(course.id));
    const { data } = await client.from('course_files').select('*').in('course_id', courses.map(course => course.id)).order('created_at', { ascending: false });
    const files = data || [];
    root.innerHTML = `<section class="hero"><span class="eyebrow">PENGELOLAAN FILE</span><h1>File mata kuliah.</h1><p>Unggah dan bagikan file untuk mata kuliah yang terhubung ke akun ini.</p><div class="hero-actions"><button id="fileSignOut" class="button button-secondary">Keluar</button></div></section><section class="panel admin-panel"><div class="panel-heading"><div><h2>Upload file</h2><p>Maksimum 20 MB per file. Verifikasi password tetap digunakan.</p></div></div><form id="fileForm" class="admin-form"><label><span class="field-label">Mata kuliah *</span><select class="select-field" name="courseId" required>${courses.map(course => `<option value="${esc(course.id)}">${esc(course.name)}</option>`).join('')}</select></label><label><span class="field-label">Nama file *</span><input class="text-field" name="name" placeholder="Contoh: RPS Pendidikan Karakter" required maxlength="140"></label><label><span class="field-label">Pilih file *</span><input class="file-field" name="file" type="file" required></label><p class="form-message"></p><button class="button button-primary">📤 Upload file</button></form></section><section class="panel admin-panel"><div class="panel-heading"><div><h2>File tersimpan</h2><p>File dikelompokkan berdasarkan mata kuliah.</p></div></div><div class="admin-file-course-list">${files.length ? fileGroups(files) : '<div class="empty-state">Belum ada file.</div>'}</div></section><dialog id="fileDialog"><div class="dialog-content"><h2>Verifikasi upload</h2><p>Masukkan password akun untuk melanjutkan.</p><form id="fileVerify" class="admin-form"><label><span class="field-label">Password akun *</span><span class="password-field"><input class="text-field" name="password" type="password" required><button class="password-toggle" type="button">👁️</button></span></label><p id="verifyMessage" class="form-message"></p><div class="dialog-actions"><button type="button" class="button button-secondary" data-cancel>Batal</button><button class="button button-primary">Verifikasi & upload</button></div></form></div></dialog>`;
    root.querySelector('#fileSignOut').onclick = async () => { await client.auth.signOut(); login(); };
    root.querySelectorAll('[data-delete-file]').forEach(button => button.onclick = () => removeFile(files.find(file => file.id === button.dataset.deleteFile)));
    const form = root.querySelector('#fileForm'), dialog = root.querySelector('#fileDialog'), verify = root.querySelector('#fileVerify');
    passwordToggle(verify.querySelector('.password-toggle')); root.querySelector('[data-cancel]').onclick = () => dialog.close(); form.onsubmit = event => { event.preventDefault(); dialog.showModal(); };
    verify.onsubmit = event => upload(event, form, dialog);
  }
  async function verify(password) { const { data: { user } } = await client.auth.getUser(); const { error } = await client.auth.signInWithPassword({ email: user?.email, password }); return error ? 'Password akun tidak sesuai.' : null; }
  async function upload(event, form, dialog) {
    event.preventDefault(); const msg = root.querySelector('#verifyMessage'); const problem = await verify(event.currentTarget.elements.password.value); if (problem) { msg.className = 'form-message form-message-error'; msg.textContent = problem; return; }
    const file = form.elements.file.files[0]; if (!file || file.size > 20 * 1024 * 1024) { msg.className = 'form-message form-message-error'; msg.textContent = 'Pilih file maksimal 20 MB.'; return; }
    const courseId = form.elements.courseId.value, path = `${courseId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '-')}`;
    const { error: uploadError } = await client.storage.from('course-files').upload(path, file, { upsert: false }); if (uploadError) { msg.className = 'form-message form-message-error'; msg.textContent = uploadError.message; return; }
    const fileUrl = client.storage.from('course-files').getPublicUrl(path).data.publicUrl; const { data: { user } } = await client.auth.getUser(); const { error: saveError } = await client.from('course_files').insert({ course_id: courseId, name: form.elements.name.value.trim(), file_name: file.name, file_url: fileUrl, created_by: user.id }); if (saveError) { msg.className = 'form-message form-message-error'; msg.textContent = saveError.message; return; }
    dialog.close(); render();
  }
  async function removeFile(file) {
    if (!file || !window.confirm(`Hapus file “${file.name}”?`)) return; const password = window.prompt('Masukkan password akun untuk menghapus file:'); if (!password) return; const problem = await verify(password); if (problem) return window.alert(problem);
    const marker = '/course-files/', path = file.file_url.includes(marker) ? file.file_url.split(marker)[1].split('?')[0] : null; if (path) { const { error } = await client.storage.from('course-files').remove([path]); if (error) return window.alert(`File belum terhapus: ${error.message}`); }
    const { error } = await client.from('course_files').delete().eq('id', file.id); if (error) return window.alert(`Data file belum terhapus: ${error.message}`); render();
  }
  client.auth.getSession().then(({ data }) => data.session ? render() : login());
})();
