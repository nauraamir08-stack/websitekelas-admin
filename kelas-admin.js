'use strict';

(() => {
  const root = document.getElementById('adminPage');
  const config = window.SUPABASE_CONFIG;
  const api = window.supabase;
  const portal = window.CLASS_PORTAL || { courses: [] };
  const courseDetailsById = new Map((portal.courses || []).map(course => [course.id, course]));

  if (!root) return;

  const escapeHTML = value => String(value ?? '').replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[char]));

  if (!api?.createClient || !config?.url || !config?.publishableKey) {
    root.innerHTML = '<div class="error-card"><strong>Konfigurasi Supabase belum tersedia.</strong><p>Periksa berkas <code>kelas-supabase.js</code>.</p></div>';
    return;
  }

  const client = api.createClient(config.url, config.publishableKey);
  let courses = portal.courses || [];
  let studentProfiles = [];
  let pendingDeleteTasks = [];
  let pendingSaveForm = null;

  async function loadAnnouncementSettings() {
    const { data } = await client.from('site_announcements').select('*').eq('id', 1).maybeSingle();
    return data || { maintenance_enabled: false, maintenance_message: '', task_update_enabled: false, task_update_message: '' };
  }

  function setupAnnouncementSettings(settings) {
    const form = root.querySelector('#announcementForm');
    if (!form) return;
    form.elements.maintenanceEnabled.checked = Boolean(settings.maintenance_enabled);
    form.elements.maintenanceMessage.value = settings.maintenance_message || '';
    form.elements.taskUpdateEnabled.checked = Boolean(settings.task_update_enabled);
    form.elements.taskUpdateMessage.value = settings.task_update_message || '';
    form.addEventListener('submit', async event => {
      event.preventDefault(); const message = form.querySelector('.form-message'); const button = form.querySelector('button[type="submit"]');
      button.disabled = true; button.textContent = 'Menyimpan…';
      const { error } = await client.from('site_announcements').update({ maintenance_enabled: form.elements.maintenanceEnabled.checked, maintenance_message: form.elements.maintenanceMessage.value.trim() || 'Website sedang dalam perbaikan. Silakan coba lagi beberapa saat lagi.', task_update_enabled: form.elements.taskUpdateEnabled.checked, task_update_message: form.elements.taskUpdateMessage.value.trim() || 'Pengelola sedang menambahkan tugas baru. Silakan cek kembali sebentar lagi.', updated_at: new Date().toISOString() }).eq('id', 1);
      message.className = error ? 'form-message form-message-error' : 'form-message form-message-success'; message.textContent = error ? `Notifikasi belum tersimpan: ${error.message}` : 'Notifikasi untuk mahasiswa berhasil diperbarui.';
      button.disabled = false; button.textContent = 'Simpan notifikasi';
    });
  }

  function passwordIcon(visible) {
    return visible
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 4.2A10.7 10.7 0 0 1 12 4c5.2 0 8.7 4.1 9.7 6.5a1.4 1.4 0 0 1 0 1c-.6 1.5-1.9 3.3-3.9 4.6M6.5 6.5C4.1 7.9 2.7 10.2 2.3 11.5a1.4 1.4 0 0 0 0 1C3.3 14.9 6.8 19 12 19c1 0 2-.2 2.9-.5"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.3 11.5a1.4 1.4 0 0 0 0 1C3.3 14.9 6.8 19 12 19s8.7-4.1 9.7-6.5a1.4 1.4 0 0 0 0-1C20.7 9.1 17.2 5 12 5S3.3 9.1 2.3 11.5Z"/><circle cx="12" cy="12" r="3"/></svg>';
  }

  function setupPasswordToggles(scope) {
    scope.querySelectorAll('[data-password-toggle]').forEach(button => {
      const input = button.closest('.password-field')?.querySelector('input');
      if (!input) return;
      button.innerHTML = passwordIcon(false);
      button.addEventListener('click', () => {
        const visible = input.type === 'password';
        input.type = visible ? 'text' : 'password';
        button.setAttribute('aria-label', visible ? 'Sembunyikan password' : 'Tampilkan password');
        button.setAttribute('title', visible ? 'Sembunyikan password' : 'Tampilkan password');
        button.setAttribute('aria-pressed', String(visible));
        button.innerHTML = passwordIcon(visible);
      });
    });
  }

  function showLogin(message = '') {
    root.innerHTML = `
      <section class="hero"><span class="eyebrow">AREA ADMIN</span><h1>Kelola tugas kelas.</h1><p>Masuk menggunakan akun admin untuk menambahkan tugas tanpa mengubah kode website.</p></section>
      <section class="admin-auth-card panel">
        <div class="panel-heading"><div><h2>Masuk admin</h2><p>Gunakan email dan kata sandi akun admin yang dibuat di Supabase.</p></div></div>
        ${message ? `<p class="form-message form-message-error">${escapeHTML(message)}</p>` : ''}
        <form id="adminLoginForm" class="admin-form">
          <label><span class="field-label">Email</span><input class="text-field" name="email" type="email" autocomplete="email" required></label>
          <label><span class="field-label">Kata sandi</span><span class="password-field"><input class="text-field" name="password" type="password" autocomplete="current-password" required><button class="password-toggle" type="button" data-password-toggle aria-label="Tampilkan password" aria-pressed="false" title="Tampilkan password"></button></span></label>
          <button class="button button-primary" type="submit">Masuk →</button>
        </form>
      </section>
    `;
    const form = root.querySelector('#adminLoginForm');
    setupPasswordToggles(form);
    form.addEventListener('submit', signIn);
  }

  async function signIn(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button');
    button.disabled = true;
    button.textContent = 'Memeriksa akun…';
    const { error } = await client.auth.signInWithPassword({
      email: form.elements.email.value.trim(),
      password: form.elements.password.value,
    });
    if (error) {
      showLogin('Email atau kata sandi tidak sesuai.');
      return;
    }
    await showDashboard();
  }

  async function getManagedCourses() {
    const [{ data: allCourses, error: coursesError }, { data: accessRows, error: accessError }] = await Promise.all([
      client.from('courses').select('id, name').order('name'),
      client.from('course_admins').select('course_id'),
    ]);
    if (coursesError || accessError) return { courses: [], error: coursesError || accessError };
    const managedCourseIds = new Set((accessRows || []).map(row => row.course_id));
    courses = (allCourses || [])
      .filter(course => managedCourseIds.has(course.id))
      .map(course => ({ ...(courseDetailsById.get(course.id) || {}), ...course }));
    return { courses, error: null };
  }

  async function hasGroupTables() {
    const { error } = await client.from('groups').select('id').limit(1);
    return !error;
  }

  async function getTasks(courseIds) {
    if (!courseIds.length) return { tasks: [], error: null };
    const { data, error } = await client
      .from('tasks')
      .select('*')
      .in('course_id', courseIds)
      .order('due_at', { ascending: true });
    return { tasks: data || [], error };
  }

  function normalizePersonName(value) {
    return String(value ?? '')
      .toLocaleLowerCase('id-ID')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '');
  }

  function findStudentProfile(name) {
    const needle = normalizePersonName(name);
    if (!needle) return null;
    const exact = studentProfiles.filter(profile => normalizePersonName(profile.full_name) === needle);
    if (exact.length === 1) return exact[0];
    const phraseMatches = studentProfiles.filter(profile => {
      const fullName = normalizePersonName(profile.full_name);
      return needle.length >= 4 && (fullName.includes(needle) || needle.includes(fullName));
    });
    return phraseMatches.length === 1 ? phraseMatches[0] : null;
  }

  function getMemberRows(memberNames) {
    const unmatchedNames = [];
    const memberRows = memberNames.map(name => {
      const profile = findStudentProfile(name);
      if (!profile) unmatchedNames.push(name);
      return { name, student_id: profile?.user_id || null };
    });
    return { memberRows, unmatchedNames };
  }

  function formatAdminDate(value) {
    return new Date(value).toLocaleDateString('id-ID', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }

  function exportTasksCSV(tasks, courseNameById) {
    const rows = [['Mata kuliah', 'Tipe', 'Judul', 'Deskripsi', 'Deadline', 'Pertemuan']];
    (tasks || []).forEach(task => rows.push([courseNameById.get(task.course_id) || '', task.type || '', task.title || '', task.description || '', task.due_at || '', task.meeting || '']));
    const csv = rows.map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `backup-tugas-${new Date().toISOString().slice(0,10)}.csv`; link.click(); URL.revokeObjectURL(url);
  }

  function getMeetingDeadline(course, meeting) {
    const schedule = course?.classSchedule;
    const semesterStart = portal.semesterStart;
    if (!schedule || !semesterStart || !Number.isInteger(Number(meeting))) return null;
    const startDate = new Date(`${semesterStart}T00:00:00`);
    if (Number.isNaN(startDate.getTime())) return null;
    const firstMeetingDate = new Date(startDate);
    firstMeetingDate.setDate(startDate.getDate() + ((schedule.weekday - startDate.getDay() + 7) % 7) + ((Number(meeting) - 1) * 7));
    const [hours, minutes] = schedule.start.split(':').map(Number);
    firstMeetingDate.setHours(hours, minutes, 0, 0);
    return firstMeetingDate;
  }

  function meetingOptions() {
    return Array.from({ length: 16 }, (_, index) => {
      const number = index + 1;
      return `<option value="${number}">Pertemuan ke-${number}</option>`;
    }).join('');
  }

  function taskScheduleLabel(task) {
    if (task.type === 'kelompok' && task.meeting) {
      const meetingLabel = `Pertemuan ke-${task.meeting}`;
      return task.due_at ? `${meetingLabel} · Deadline ${formatAdminDate(task.due_at)}` : meetingLabel;
    }
    return `Deadline ${formatAdminDate(task.due_at)}`;
  }

  function renderAdminTaskList(tasks, courseNameById, courseId = '') {
    const filteredTasks = courseId ? tasks.filter(task => task.course_id === courseId) : tasks;
    if (!filteredTasks.length) {
      return '<div class="empty-state">Tidak ada tugas pada mata kuliah ini.</div>';
    }
    return `<div class="admin-task-list">${filteredTasks.map(task => `
      <article class="admin-task-item">
        <div><span class="badge badge-${task.type === 'kelompok' ? 'kelompok' : 'individu'}">${task.type === 'kelompok' ? '👥 Kelompok' : '👤 Individu'}</span><h3>${escapeHTML(task.title)}</h3><p>${escapeHTML(courseNameById.get(task.course_id) || 'Mata kuliah')} · ${escapeHTML(taskScheduleLabel(task))}</p></div>
        <div class="admin-task-actions"><label class="task-select-control"><input type="checkbox" data-select-task="${escapeHTML(task.id)}"><span>Pilih</span></label><button class="button button-secondary" type="button" data-edit-task="${escapeHTML(task.id)}">Edit</button><button class="button button-danger" type="button" data-delete-task="${escapeHTML(task.id)}" data-group-id="${escapeHTML(task.group_id || '')}" data-task-title="${escapeHTML(task.title)}">Hapus</button></div>
      </article>
    `).join('')}</div>`;
  }

  function setupTaskManagement(tasks, courseNameById) {
    const taskList = root.querySelector('#adminTaskList');
    const courseFilter = root.querySelector('#taskCourseFilter');
    const bulkButton = root.querySelector('#bulkDeleteTasks');
    const selectionText = root.querySelector('#bulkDeleteSelection');
    if (!taskList || !courseFilter || !bulkButton || !selectionText) return;
    const selectedTaskIds = new Set();
    const getSelectedTasks = () => tasks.filter(task => selectedTaskIds.has(task.id));
    const updateBulkDeleteButton = () => {
      const count = selectedTaskIds.size;
      selectionText.textContent = count ? `${count} tugas dipilih.` : 'Pilih satu atau beberapa tugas untuk dihapus bersama.';
      bulkButton.disabled = count === 0;
      bulkButton.textContent = count ? `Hapus ${count} tugas terpilih` : 'Hapus tugas terpilih';
    };
    const render = () => {
      taskList.innerHTML = renderAdminTaskList(tasks, courseNameById, courseFilter.value);
      taskList.querySelectorAll('[data-select-task]').forEach(checkbox => {
        checkbox.checked = selectedTaskIds.has(checkbox.dataset.selectTask);
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) selectedTaskIds.add(checkbox.dataset.selectTask);
          else selectedTaskIds.delete(checkbox.dataset.selectTask);
          updateBulkDeleteButton();
        });
      });
      taskList.querySelectorAll('[data-delete-task]').forEach(button => button.addEventListener('click', openDeleteDialog));
      taskList.querySelectorAll('[data-edit-task]').forEach(button => button.addEventListener('click', () => editTask(tasks.find(task => task.id === button.dataset.editTask))));
    };
    courseFilter.addEventListener('change', render);
    bulkButton.addEventListener('click', () => openDeleteDialogForTasks(getSelectedTasks()));
    render();
    updateBulkDeleteButton();
  }

  function setTaskType(form) {
    const isGroupTask = form.elements.type.value === 'kelompok';
    const individualFields = form.querySelector('#individualTaskFields');
    const groupFields = form.querySelector('#groupTaskFields');
    individualFields.hidden = isGroupTask;
    groupFields.hidden = !isGroupTask;
    individualFields.querySelectorAll('input, textarea').forEach(field => { field.disabled = isGroupTask; });
    groupFields.querySelectorAll('input, textarea').forEach(field => { field.disabled = !isGroupTask; });
  }

  function updateGroupMeetingDeadline(form) {
    const deadlineNote = form.querySelector('#groupMeetingDeadline');
    if (!deadlineNote) return;
    const course = courses.find(item => item.id === form.elements.courseId.value);
    const deadline = getMeetingDeadline(course, form.elements.groupMeeting.value);
    deadlineNote.textContent = deadline
      ? `Deadline otomatis: ${formatAdminDate(deadline.toISOString())}.`
      : 'Pilih pertemuan untuk menghitung deadline otomatis.';
  }

  async function showDashboard(notice = '') {
    const { data: hasCourseAccess, error: accessError } = await client.rpc('has_course_access');
    if (accessError || !hasCourseAccess) {
      await client.auth.signOut();
      showLogin('Akun ini belum diberi akses ke mata kuliah. Jalankan supabase-course-admins-setup.sql, lalu hubungkan akun ini ke satu mata kuliah.');
      return;
    }

    const { error: managedCoursesError } = await getManagedCourses();
    if (managedCoursesError || !courses.length) {
      await client.auth.signOut();
      showLogin('Akun ini belum terhubung ke mata kuliah. Periksa tabel course_admins di Supabase.');
      return;
    }
    const [groupTablesReady, { tasks, error: tasksError }, announcementSettings] = await Promise.all([
      hasGroupTables(),
      getTasks(courses.map(course => course.id)),
      loadAnnouncementSettings(),
    ]);
    const { data: profiles, error: profilesError } = await client
      .from('student_profiles')
      .select('user_id, nim, full_name')
      .order('full_name');
    studentProfiles = profiles || [];
    const courseOptions = courses.map(course => `<option value="${escapeHTML(course.id)}">${escapeHTML(course.name)}</option>`).join('');
    const courseNameById = new Map(courses.map(course => [course.id, course.name]));
    const groupSetupMessage = groupTablesReady
      ? ''
      : '<p class="form-message form-message-error">Fitur kelompok belum disiapkan di database. Jalankan berkas <code>supabase-groups-setup.sql</code> di SQL Editor Supabase, lalu muat ulang halaman ini.</p>';
    const studentSetupMessage = profilesError
      ? '<p class="form-message form-message-error">Akses mahasiswa belum disiapkan. Jalankan <code>supabase-students-setup.sql</code> di SQL Editor Supabase sebelum membuat tugas kelompok.</p>'
      : '';

    root.innerHTML = `
      <section class="hero"><span class="eyebrow">PANEL PENGELOLA</span><h1>Kelola tugas seluruh mata kuliah.</h1><p>Pilih mata kuliah untuk menambah, menghapus, mengunggah lampiran, dan memantau tugas mahasiswa.</p><div class="hero-actions"><a class="button button-primary" href="pengacak-kelompok.html">🎲 Acak kelompok</a><button id="exportTasks" class="button button-secondary" type="button">⬇️ Ekspor Excel</button><button id="adminSignOut" class="button button-secondary" type="button">Keluar</button></div></section>
      ${notice ? `<p class="form-message form-message-success admin-notice">${escapeHTML(notice)}</p>` : ''}
      <section class="panel admin-panel"><div class="panel-heading"><div><h2>Notifikasi untuk mahasiswa</h2><p>Atur pemberitahuan yang akan muncul pada website user. Tidak memerlukan verifikasi password tambahan.</p></div></div><form id="announcementForm" class="admin-form"><label class="task-select-control"><input type="checkbox" name="maintenanceEnabled"><span>Aktifkan tampilan maintenance (menutup akses website user)</span></label><label><span class="field-label">Pesan maintenance</span><textarea class="text-field text-area" name="maintenanceMessage" rows="2" maxlength="280"></textarea></label><label class="task-select-control"><input type="checkbox" name="taskUpdateEnabled"><span>Tampilkan notifikasi “tugas sedang ditambahkan” di halaman Tugas Saya</span></label><label><span class="field-label">Pesan pembaruan tugas</span><textarea class="text-field text-area" name="taskUpdateMessage" rows="2" maxlength="280"></textarea></label><p class="form-message" aria-live="polite"></p><button class="button button-primary" type="submit">Simpan notifikasi</button></form></section>
      <section class="panel admin-panel">
        <div class="panel-heading"><div><h2>Detail tugas</h2><p>Kolom bertanda * wajib diisi.</p></div></div>
        <form id="adminTaskForm" class="admin-form" enctype="multipart/form-data">
          <div class="admin-form-grid">
            <label><span class="field-label">Mata kuliah *</span><select class="select-field" name="courseId" required>${courseOptions}</select></label>
            <label><span class="field-label">Tipe tugas *</span><select class="select-field" name="type" required><option value="individu">Individu</option><option value="kelompok">Kelompok</option></select></label>
          </div>

          <div id="individualTaskFields" class="admin-form-fields">
            <label><span class="field-label">Judul tugas *</span><input class="text-field" name="title" maxlength="140" required></label>
            <label><span class="field-label">Deskripsi *</span><textarea class="text-field text-area" name="description" rows="4" required></textarea></label>
            <div class="admin-form-grid">
              <label><span class="field-label">Deadline *</span><input class="text-field" name="dueAt" type="datetime-local" required></label>
              <label><span class="field-label">Pengumpulan</span><input class="text-field" name="submission" placeholder="Contoh: Kumpulkan melalui LMS"></label>
            </div>
            <label><span class="field-label">Checklist</span><textarea class="text-field text-area" name="checklist" rows="4" placeholder="Satu poin per baris"></textarea></label>
            <label><span class="field-label">Lampiran (opsional, maksimum 10 MB)</span><input class="file-field" name="attachment" type="file"></label>
          </div>

          <div id="groupTaskFields" class="admin-form-fields group-task-fields" hidden>
            <p class="group-form-note">Satu tugas kelompok dibuat untuk satu kelompok. Isi nama kelompok, pertemuan, dan semua anggota kelompok.</p>
            ${groupSetupMessage}
            ${studentSetupMessage}
            <label><span class="field-label">Nama kelompok *</span><input class="text-field" name="groupName" maxlength="80" placeholder="Contoh: Kelompok 1" required></label>
            <label><span class="field-label">Pertemuan *</span><select class="select-field" name="groupMeeting" required><option value="" selected disabled>Pilih pertemuan</option>${meetingOptions()}</select><small id="groupMeetingDeadline" class="field-help auto-deadline-note">Pilih pertemuan untuk menghitung deadline otomatis.</small></label>
            <div class="member-inputs-field">
              <span class="field-label">Nama anggota *</span>
              <textarea class="text-field text-area" name="memberNames" rows="6" maxlength="3000" placeholder="Tempel daftar nama di sini, satu nama per baris&#10;Contoh:&#10;Siti Aminah&#10;Budi Santoso" required></textarea>
              <small class="field-help">Bisa copy-paste banyak nama sekaligus. Setiap baris akan disimpan sebagai satu anggota.</small>
            </div>
          </div>

          <p id="adminFormMessage" class="form-message" aria-live="polite"></p>
          <button class="button button-primary" type="submit">Simpan tugas →</button>
        </form>
      </section>
      <section class="panel admin-panel">
        <div class="panel-heading"><div><h2>Hapus tugas</h2><p>Hapus tugas yang salah diinput. Tindakan ini tidak dapat dibatalkan.</p></div></div>
        ${tasksError
          ? '<p class="form-message form-message-error">Daftar tugas belum dapat dimuat. Coba muat ulang halaman.</p>'
          : `<label class="admin-task-filter"><span class="field-label">Cari tugas berdasarkan mata kuliah</span><select id="taskCourseFilter" class="select-field"><option value="">Semua mata kuliah</option>${courseOptions}</select></label><div class="bulk-delete-actions"><p id="bulkDeleteSelection">Pilih satu atau beberapa tugas untuk dihapus bersama.</p><button id="bulkDeleteTasks" class="button button-danger" type="button" disabled>Hapus tugas terpilih</button></div><div id="adminTaskList">${renderAdminTaskList(tasks, courseNameById)}</div>`}
      </section>
      <dialog id="deleteTaskDialog">
        <div class="dialog-content">
          <button class="dialog-close" type="button" aria-label="Tutup" data-close-delete-dialog>×</button>
          <span class="eyebrow" style="color:#a23535">KONFIRMASI PENGHAPUSAN</span>
          <h2>Hapus tugas</h2>
          <p id="deleteTaskDescription"></p>
          <form id="confirmDeleteTaskForm" class="admin-form">
            <label><span class="field-label">Password akun mata kuliah *</span><span class="password-field"><input class="text-field" name="password" type="password" autocomplete="current-password" required><button class="password-toggle" type="button" data-password-toggle aria-label="Tampilkan password" aria-pressed="false" title="Tampilkan password"></button></span></label>
            <p id="deleteTaskMessage" class="form-message" aria-live="polite"></p>
            <div class="dialog-actions"><button class="button button-secondary" type="button" data-close-delete-dialog>Batal</button><button class="button button-danger" type="submit">Konfirmasi hapus</button></div>
          </form>
        </div>
      </dialog>
      <dialog id="saveTaskDialog">
        <div class="dialog-content">
          <button class="dialog-close" type="button" aria-label="Tutup" data-close-save-dialog>×</button>
          <span class="eyebrow" style="color:#3855c8">VERIFIKASI PENYIMPANAN</span>
          <h2>Simpan tugas</h2>
          <p>Masukkan password akun mata kuliah untuk menyimpan tugas ini.</p>
          <form id="confirmSaveTaskForm" class="admin-form">
            <label><span class="field-label">Password akun *</span><span class="password-field"><input class="text-field" name="password" type="password" autocomplete="current-password" required><button class="password-toggle" type="button" data-password-toggle aria-label="Tampilkan password" aria-pressed="false" title="Tampilkan password"></button></span></label>
            <p id="saveTaskMessage" class="form-message" aria-live="polite"></p>
            <div class="dialog-actions"><button class="button button-secondary" type="button" data-close-save-dialog>Batal</button><button class="button button-primary" type="submit">Verifikasi & simpan</button></div>
          </form>
        </div>
      </dialog>
    `;

    root.querySelector('#adminSignOut').addEventListener('click', async () => {
      await client.auth.signOut();
      showLogin();
    });
    root.querySelector('#exportTasks').addEventListener('click', () => exportTasksCSV(tasks, courseNameById));

    const form = root.querySelector('#adminTaskForm');
    setupPasswordToggles(root);
    form.dataset.groupTablesReady = String(groupTablesReady);
    form.addEventListener('submit', requestSaveTask);
    form.elements.type.addEventListener('change', () => setTaskType(form));
    form.elements.courseId.addEventListener('change', () => updateGroupMeetingDeadline(form));
    form.elements.groupMeeting.addEventListener('change', () => updateGroupMeetingDeadline(form));
    setTaskType(form);
    updateGroupMeetingDeadline(form);
    setupTaskManagement(tasks, courseNameById);
    setupAnnouncementSettings(announcementSettings);
    setupDeleteDialog();
    setupSaveDialog();
  }

  function filenameForStorage(file, courseId) {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-');
    return `${courseId}/${Date.now()}-${safeName}`;
  }

  function setFormError(messageElement, text) {
    messageElement.className = 'form-message form-message-error';
    messageElement.textContent = text;
  }

  async function saveIndividualTask(fields, message) {
    const attachment = fields.attachment.files[0];
    let attachmentName = null;
    let attachmentUrl = null;

    if (attachment && attachment.size > 10 * 1024 * 1024) {
      setFormError(message, 'Ukuran lampiran melebihi batas 10 MB.');
      return { ok: false };
    }

    if (attachment) {
      const filePath = filenameForStorage(attachment, fields.courseId.value);
      const { error: uploadError } = await client.storage
        .from('task-attachments')
        .upload(filePath, attachment, { upsert: false });
      if (uploadError) {
        setFormError(message, `Lampiran gagal diunggah: ${uploadError.message}`);
        return { ok: false };
      }
      attachmentName = attachment.name;
      attachmentUrl = client.storage.from('task-attachments').getPublicUrl(filePath).data.publicUrl;
    }

    const checklist = fields.checklist.value.split('\n').map(item => item.trim()).filter(Boolean);
    const { error } = await client.from('tasks').insert({
      course_id: fields.courseId.value,
      type: 'individu',
      title: fields.title.value.trim(),
      description: fields.description.value.trim(),
      due_at: new Date(fields.dueAt.value).toISOString(),
      checklist,
      submission: fields.submission.value.trim(),
      attachment_name: attachmentName,
      attachment_url: attachmentUrl,
    });
    if (error) {
      setFormError(message, `Tugas belum tersimpan: ${error.message}`);
      return { ok: false };
    }
    return { ok: true, notice: 'Tugas individu berhasil disimpan.' };
  }

  async function saveGroupTask(form, fields, message) {
    if (form.dataset.groupTablesReady !== 'true') {
      setFormError(message, 'Fitur kelompok belum tersedia di database. Jalankan supabase-groups-setup.sql terlebih dahulu.');
      return { ok: false };
    }

    const meeting = Number(fields.groupMeeting.value);
    const course = courses.find(item => item.id === fields.courseId.value);
    const deadline = getMeetingDeadline(course, meeting);
    if (!deadline) {
      setFormError(message, 'Deadline otomatis belum dapat dihitung. Pilih mata kuliah dan pertemuan yang valid.');
      return { ok: false };
    }

    const memberNames = fields.memberNames.value
      .split(/\r?\n/)
      .map(name => name.trim())
      .filter(Boolean);
    if (!memberNames.length) {
      setFormError(message, 'Masukkan minimal satu nama anggota.');
      return { ok: false };
    }
    if (new Set(memberNames.map(name => name.toLocaleLowerCase('id-ID'))).size !== memberNames.length) {
      setFormError(message, 'Nama anggota tidak boleh duplikat. Hapus nama yang sama dari daftar.');
      return { ok: false };
    }
    if (!studentProfiles.length) {
      setFormError(message, 'Data akun mahasiswa belum tersedia. Jalankan supabase-students-setup.sql terlebih dahulu.');
      return { ok: false };
    }
    const { memberRows, unmatchedNames } = getMemberRows(memberNames);
    if (unmatchedNames.length) {
      setFormError(message, `Nama belum cocok dengan akun mahasiswa: ${unmatchedNames.join(', ')}. Gunakan nama lengkap atau satu frasa nama yang unik.`);
      return { ok: false };
    }

    const { data: group, error: groupError } = await client
      .from('groups')
      .insert({ course_id: fields.courseId.value, name: fields.groupName.value.trim(), progress: 0 })
      .select('id')
      .single();
    if (groupError) {
      const errorMessage = groupError.code === '23505'
        ? 'Nama kelompok sudah pernah dipakai pada mata kuliah ini. Jalankan ulang supabase-groups-setup.sql versi terbaru, lalu coba simpan kembali.'
        : `Kelompok belum tersimpan: ${groupError.message}`;
      setFormError(message, errorMessage);
      return { ok: false };
    }

    const { error: membersError } = await client.from('group_members').insert(
      memberRows.map(member => ({ group_id: group.id, ...member })),
    );
    if (membersError) {
      await client.from('groups').delete().eq('id', group.id);
      setFormError(message, `Anggota belum tersimpan: ${membersError.message}`);
      return { ok: false };
    }

    const { error: taskError } = await client.from('tasks').insert({
      course_id: fields.courseId.value,
      type: 'kelompok',
      title: `Tugas ${fields.groupName.value.trim()}`,
      description: '',
      due_at: deadline.toISOString(),
      meeting,
      checklist: [],
      submission: '',
      group_id: group.id,
    });
    if (taskError) {
      await client.from('groups').delete().eq('id', group.id);
      const errorMessage = taskError.code === '23502' || taskError.code === 'PGRST204'
        ? 'Database belum mendukung kolom pertemuan. Jalankan ulang supabase-groups-setup.sql versi terbaru, lalu coba kembali.'
        : `Tugas kelompok belum tersimpan: ${taskError.message}`;
      setFormError(message, errorMessage);
      return { ok: false };
    }
    return { ok: true, notice: 'Tugas kelompok beserta anggota berhasil disimpan.' };
  }

  function requestSaveTask(event) {
    event.preventDefault();
    pendingSaveForm = event.currentTarget;
    const dialog = root.querySelector('#saveTaskDialog');
    root.querySelector('#saveTaskMessage').textContent = '';
    dialog.showModal();
    dialog.querySelector('input[name="password"]').focus();
  }

  async function saveTask(form) {
    const button = form.querySelector('button[type="submit"]');
    const message = root.querySelector('#adminFormMessage');
    const fields = form.elements;
    button.disabled = true;
    button.textContent = 'Menyimpan…';
    message.className = 'form-message';
    message.textContent = '';

    const result = fields.type.value === 'kelompok'
      ? await saveGroupTask(form, fields, message)
      : await saveIndividualTask(fields, message);

    if (!result.ok) {
      button.disabled = false;
      button.textContent = 'Simpan tugas →';
      return;
    }

    form.reset();
    setTaskType(form);
    message.className = 'form-message form-message-success';
    message.textContent = result.notice;
    button.disabled = false;
    button.textContent = 'Simpan tugas →';
  }

  async function verifyCurrentPassword(password) {
    const { data: { user }, error: userError } = await client.auth.getUser();
    if (userError || !user?.email) return { error: 'Sesi akun tidak valid. Silakan masuk kembali.' };
    const { error: passwordError } = await client.auth.signInWithPassword({ email: user.email, password });
    return { error: passwordError ? 'Password akun tidak sesuai.' : null };
  }

  function setupSaveDialog() {
    const dialog = root.querySelector('#saveTaskDialog');
    const form = root.querySelector('#confirmSaveTaskForm');
    root.querySelectorAll('[data-close-save-dialog]').forEach(button => {
      button.addEventListener('click', () => dialog.close());
    });
    dialog.addEventListener('close', () => {
      pendingSaveForm = null;
      form.reset();
      root.querySelector('#saveTaskMessage').textContent = '';
    });
    form.addEventListener('submit', confirmSaveTask);
  }

  async function confirmSaveTask(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const message = root.querySelector('#saveTaskMessage');
    if (!pendingSaveForm) {
      setFormError(message, 'Tugas yang akan disimpan tidak ditemukan.');
      return;
    }

    button.disabled = true;
    button.textContent = 'Memeriksa…';
    message.className = 'form-message';
    message.textContent = '';
    const { error } = await verifyCurrentPassword(form.elements.password.value);
    if (error) {
      setFormError(message, error);
      button.disabled = false;
      button.textContent = 'Verifikasi & simpan';
      return;
    }

    const taskForm = pendingSaveForm;
    root.querySelector('#saveTaskDialog').close();
    await saveTask(taskForm);
  }

  function setupDeleteDialog() {
    const dialog = root.querySelector('#deleteTaskDialog');
    const form = root.querySelector('#confirmDeleteTaskForm');
    root.querySelectorAll('[data-close-delete-dialog]').forEach(button => {
      button.addEventListener('click', () => dialog.close());
    });
    dialog.addEventListener('close', () => {
      pendingDeleteTasks = [];
      form.reset();
      root.querySelector('#deleteTaskMessage').textContent = '';
    });
    form.addEventListener('submit', confirmDeleteTask);
  }

  function openDeleteDialog(event) {
    const button = event.currentTarget;
    openDeleteDialogForTasks([{
      id: button.dataset.deleteTask,
      groupId: button.dataset.groupId,
      title: button.dataset.taskTitle || 'tugas ini',
    }]);
  }

  function openDeleteDialogForTasks(tasks) {
    if (!tasks.length) return;
    pendingDeleteTasks = tasks;
    const dialog = root.querySelector('#deleteTaskDialog');
    const isBulkDelete = tasks.length > 1;
    root.querySelector('#deleteTaskDescription').textContent = isBulkDelete
      ? `Masukkan password akun mata kuliah untuk menghapus ${tasks.length} tugas terpilih. Tindakan ini tidak dapat dibatalkan.`
      : `Masukkan password akun mata kuliah untuk menghapus tugas “${tasks[0].title}”. Tindakan ini tidak dapat dibatalkan.`;
    dialog.querySelector('h2').textContent = isBulkDelete ? `Hapus ${tasks.length} tugas` : 'Hapus tugas';
    dialog.querySelector('button[type="submit"]').textContent = isBulkDelete ? 'Konfirmasi hapus semua' : 'Konfirmasi hapus';
    root.querySelector('#deleteTaskMessage').textContent = '';
    dialog.showModal();
    dialog.querySelector('input[name="password"]').focus();
  }

  async function confirmDeleteTask(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const message = root.querySelector('#deleteTaskMessage');
    if (!pendingDeleteTasks.length) {
      message.className = 'form-message form-message-error';
      message.textContent = 'Tugas yang akan dihapus tidak ditemukan.';
      return;
    }

    button.disabled = true;
    button.textContent = 'Memeriksa…';
    message.className = 'form-message';
    message.textContent = '';
    const { error } = await verifyCurrentPassword(form.elements.password.value);
    if (error) {
      setFormError(message, error);
      button.disabled = false;
      button.textContent = pendingDeleteTasks.length > 1 ? 'Konfirmasi hapus semua' : 'Konfirmasi hapus';
      return;
    }

    const tasks = pendingDeleteTasks;
    root.querySelector('#deleteTaskDialog').close();
    await deleteTasks(tasks);
  }

  async function deleteTasks(tasks) {
    let deletedCount = 0;
    let groupCleanupFailures = 0;
    const failedTitles = [];

    for (const task of tasks) {
      const { error: taskError } = await client.from('tasks').delete().eq('id', task.id);
      if (taskError) {
        failedTitles.push(task.title);
        continue;
      }
      deletedCount += 1;
      if (task.groupId) {
        const { error: groupError } = await client.from('groups').delete().eq('id', task.groupId);
        if (groupError) groupCleanupFailures += 1;
      }
    }

    if (!deletedCount) {
      await showDashboard('Tidak ada tugas yang dihapus. Pastikan tugas masih tersedia dan Anda memiliki aksesnya.');
      return;
    }

    const deletedLabel = deletedCount === 1 ? '1 tugas berhasil dihapus.' : `${deletedCount} tugas berhasil dihapus.`;
    const failedLabel = failedTitles.length
      ? ` ${failedTitles.length} tugas tidak dapat dihapus.`
      : '';
    const groupLabel = groupCleanupFailures
      ? ` Data kelompok untuk ${groupCleanupFailures} tugas belum terhapus dan perlu dibersihkan melalui Supabase.`
      : '';
    await showDashboard(`${deletedLabel}${failedLabel}${groupLabel}`);
  }

  async function editTask(task) {
    if (!task) return;
    const title = window.prompt('Judul tugas:', task.title);
    if (title === null || !title.trim()) return;
    const description = window.prompt('Deskripsi tugas:', task.description || '');
    if (description === null) return;
    const { error } = await client.from('tasks').update({ title: title.trim(), description: description.trim() }).eq('id', task.id);
    if (error) { window.alert(`Tugas belum diperbarui: ${error.message}`); return; }
    await showDashboard('Tugas berhasil diperbarui.');
  }

  async function start() {
    const { data: { session } } = await client.auth.getSession();
    if (session) await showDashboard();
    else showLogin();
  }

  start();
})();
