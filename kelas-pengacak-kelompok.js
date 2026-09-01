'use strict';

(() => {
  const root = document.getElementById('groupRandomizerPage');
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
  let managedCourses = [];
  let managedCourse = null;
  let studentProfiles = [];
  let generatedPlan = null;

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

  function setMessage(element, text, type = '') {
    element.className = `form-message${type ? ` form-message-${type}` : ''}`;
    element.textContent = text;
  }

  function meetingOptions(selected) {
    return Array.from({ length: 16 }, (_, index) => {
      const number = index + 1;
      return `<option value="${number}" ${number === selected ? 'selected' : ''}>Pertemuan ke-${number}</option>`;
    }).join('');
  }

  function managedCourseOptions() {
    return managedCourses.map(course => `<option value="${escapeHTML(course.id)}" ${course.id === managedCourse?.id ? 'selected' : ''}>${escapeHTML(course.name)}</option>`).join('');
  }

  function formatDeadline(value) {
    if (!value) return 'belum dapat dihitung';
    return new Date(value).toLocaleDateString('id-ID', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }

  function getMeetingDeadline(meeting) {
    const schedule = managedCourse?.classSchedule;
    if (!schedule || !portal.semesterStart || !Number.isInteger(Number(meeting))) return null;
    const semesterStart = new Date(`${portal.semesterStart}T00:00:00`);
    if (Number.isNaN(semesterStart.getTime())) return null;
    const deadline = new Date(semesterStart);
    deadline.setDate(semesterStart.getDate() + ((schedule.weekday - semesterStart.getDay() + 7) % 7) + ((Number(meeting) - 1) * 7));
    const [hours, minutes] = schedule.start.split(':').map(Number);
    deadline.setHours(hours, minutes, 0, 0);
    return deadline;
  }

  function parseNames(value) {
    return value.split(/\r?\n/).map(name => name.trim()).filter(Boolean);
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

  function findDuplicateName(names) {
    const seen = new Set();
    return names.find(name => {
      const normalized = name.toLocaleLowerCase('id-ID');
      if (seen.has(normalized)) return true;
      seen.add(normalized);
      return false;
    });
  }

  function secureShuffle(items) {
    const shuffled = [...items];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const limit = 0x100000000 - (0x100000000 % (index + 1));
      let randomValue;
      do {
        randomValue = crypto.getRandomValues(new Uint32Array(1))[0];
      } while (randomValue >= limit);
      const swapIndex = randomValue % (index + 1);
      [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }
    return shuffled;
  }

  function chooseRandom(items) {
    return items[crypto.getRandomValues(new Uint32Array(1))[0] % items.length];
  }

  function distributeNames(groups, names, gender) {
    secureShuffle(names).forEach(name => {
      const availableGroups = groups.filter(group => group.members.length < group.capacity);
      const leastSameGender = Math.min(...availableGroups.map(group => group[gender]));
      const genderBalancedGroups = availableGroups.filter(group => group[gender] === leastSameGender);
      const smallestGroup = Math.min(...genderBalancedGroups.map(group => group.members.length));
      const candidates = genderBalancedGroups.filter(group => group.members.length === smallestGroup);
      const target = chooseRandom(candidates);
      target.members.push({ name, gender });
      target[gender] += 1;
    });
  }

  function randomMeetings(groupCount, start, end) {
    const possibleMeetings = Array.from({ length: end - start + 1 }, (_, index) => start + index);
    const assigned = [];
    while (assigned.length < groupCount) assigned.push(...secureShuffle(possibleMeetings));
    return assigned.slice(0, groupCount);
  }

  function renderPage() {
    root.innerHTML = `
      <section class="hero">
        <span class="eyebrow">PENGACAK KELOMPOK</span>
        <h1>Susun kelompok <span id="randomizerCourseName">${escapeHTML(managedCourse.name)}</span>.</h1>
        <p>Masukkan nama berdasarkan gender, pilih jumlah kelompok serta rentang pertemuan. Tanggal deadline dihitung otomatis dari jadwal kuliah dan hasilnya dapat disimpan sekaligus.</p>
        <div class="hero-actions"><a class="button button-secondary" href="index.html">← Kembali ke admin</a></div>
      </section>
      <section class="panel admin-panel">
        <div class="panel-heading"><div><h2>Data pengacakan</h2><p>Nama dalam setiap daftar ditulis satu per baris. Gunakan nama lengkap atau satu frasa nama yang unik agar anggota tersambung ke akun mahasiswa. Jumlah anggota setiap kelompok akan dibuat seimbang, dengan sebaran laki-laki dan perempuan diupayakan merata.</p></div></div>
        <form id="groupRandomizerForm" class="admin-form">
          <div class="admin-form-grid">
            <label><span class="field-label">Mata kuliah *</span><select class="select-field" name="courseId" required>${managedCourseOptions()}</select></label>
            <label><span class="field-label">Jumlah kelompok *</span><input class="text-field" name="groupCount" type="number" min="1" max="100" inputmode="numeric" required></label>
          </div>
          <div class="admin-form-grid">
            <label><span class="field-label">Awalan nama kelompok</span><input class="text-field" name="groupPrefix" value="Kelompok" maxlength="60" required></label>
            <div class="meeting-range-field"><span class="field-label">Acak deadline pertemuan *</span><div class="meeting-range-controls"><select class="select-field" name="meetingStart" aria-label="Pertemuan awal">${meetingOptions(1)}</select><span>sampai</span><select class="select-field" name="meetingEnd" aria-label="Pertemuan akhir">${meetingOptions(16)}</select></div><small class="field-help">Setiap kelompok mendapat satu pertemuan acak dari rentang ini. Pertemuan dapat berulang bila kelompok lebih banyak daripada pilihan pertemuan.</small><small id="meetingDeadlineHint" class="field-help auto-deadline-note">Pertemuan 1: ${escapeHTML(formatDeadline(getMeetingDeadline(1)))}</small></div>
          </div>
          <div class="admin-form-grid group-randomizer-inputs">
            <label><span class="field-label">Nama laki-laki</span><textarea class="text-field text-area" name="maleNames" rows="10" maxlength="6000" placeholder="Satu nama per baris&#10;Contoh:&#10;Budi Santoso&#10;Andi Saputra"></textarea></label>
            <label><span class="field-label">Nama perempuan</span><textarea class="text-field text-area" name="femaleNames" rows="10" maxlength="6000" placeholder="Satu nama per baris&#10;Contoh:&#10;Siti Aminah&#10;Dewi Lestari"></textarea></label>
          </div>
          <p id="randomizerMessage" class="form-message" aria-live="polite"></p>
          <div class="randomizer-actions"><button id="generateGroups" class="button button-secondary" type="button">🎲 Acak kelompok</button><button id="saveGeneratedGroups" class="button button-primary" type="button" disabled>Simpan semua tugas →</button></div>
        </form>
      </section>
      <section id="generatedGroupsPanel" class="panel admin-panel" hidden>
        <div class="panel-heading"><div><h2>Pratinjau hasil</h2><p id="generatedGroupsSummary"></p></div></div>
        <div id="generatedGroupsList" class="random-group-list"></div>
      </section>
      <dialog id="bulkSaveDialog">
        <div class="dialog-content">
          <button class="dialog-close" type="button" aria-label="Tutup" data-close-bulk-dialog>×</button>
          <span class="eyebrow" style="color:#3855c8">VERIFIKASI PENYIMPANAN</span>
          <h2>Simpan seluruh kelompok</h2>
          <p id="bulkSaveDescription"></p>
          <form id="bulkSaveForm" class="admin-form">
            <label><span class="field-label">Password akun mata kuliah *</span><span class="password-field"><input class="text-field" name="password" type="password" autocomplete="current-password" required><button class="password-toggle" type="button" data-password-toggle aria-label="Tampilkan password" aria-pressed="false" title="Tampilkan password"></button></span></label>
            <p id="bulkSaveMessage" class="form-message" aria-live="polite"></p>
            <div class="dialog-actions"><button class="button button-secondary" type="button" data-close-bulk-dialog>Batal</button><button class="button button-primary" type="submit">Verifikasi & simpan semua</button></div>
          </form>
        </div>
      </dialog>
    `;

    const form = root.querySelector('#groupRandomizerForm');
    setupPasswordToggles(root);
    form.querySelectorAll('input, textarea, select').forEach(field => {
      field.addEventListener('input', () => clearGeneratedPlan(form));
      field.addEventListener('change', () => clearGeneratedPlan(form));
    });
    form.elements.courseId.addEventListener('change', () => {
      const selectedCourse = managedCourses.find(course => course.id === form.elements.courseId.value);
      if (!selectedCourse) return;
      managedCourse = selectedCourse;
      root.querySelector('#randomizerCourseName').textContent = managedCourse.name;
      root.querySelector('#meetingDeadlineHint').textContent = `Pertemuan 1: ${formatDeadline(getMeetingDeadline(1))}`;
      clearGeneratedPlan(form);
    });
    root.querySelector('#generateGroups').addEventListener('click', () => generatePlan(form));
    root.querySelector('#saveGeneratedGroups').addEventListener('click', openBulkSaveDialog);
    setupBulkSaveDialog();
  }

  function clearGeneratedPlan(form) {
    if (!generatedPlan) return;
    generatedPlan = null;
    root.querySelector('#generatedGroupsPanel').hidden = true;
    root.querySelector('#generatedGroupsList').innerHTML = '';
    root.querySelector('#saveGeneratedGroups').disabled = true;
    setMessage(root.querySelector('#randomizerMessage'), 'Data diubah. Acak kembali kelompok sebelum menyimpan.');
  }

  function generatePlan(form) {
    const fields = form.elements;
    const message = root.querySelector('#randomizerMessage');
    const maleNames = parseNames(fields.maleNames.value);
    const femaleNames = parseNames(fields.femaleNames.value);
    const allNames = [...maleNames, ...femaleNames];
    const duplicateName = findDuplicateName(allNames);
    const groupCount = Number(fields.groupCount.value);
    const meetingStart = Number(fields.meetingStart.value);
    const meetingEnd = Number(fields.meetingEnd.value);

    setMessage(message, '');
    if (!allNames.length) {
      setMessage(message, 'Masukkan minimal satu nama pada daftar laki-laki atau perempuan.', 'error');
      return;
    }
    if (!studentProfiles.length) {
      setMessage(message, 'Data akun mahasiswa belum tersedia. Jalankan supabase-students-setup.sql terlebih dahulu.', 'error');
      return;
    }
    const unmatchedNames = allNames.filter(name => !findStudentProfile(name));
    if (unmatchedNames.length) {
      setMessage(message, `Nama belum cocok dengan akun mahasiswa: ${unmatchedNames.join(', ')}. Gunakan nama lengkap atau satu frasa nama yang unik.`, 'error');
      return;
    }
    if (duplicateName) {
      setMessage(message, `Nama “${duplicateName}” ditulis lebih dari sekali. Hapus duplikat sebelum mengacak.`, 'error');
      return;
    }
    if (!Number.isInteger(groupCount) || groupCount < 1 || groupCount > allNames.length) {
      setMessage(message, `Jumlah kelompok harus antara 1 dan ${allNames.length}.`, 'error');
      return;
    }
    if (meetingStart > meetingEnd) {
      setMessage(message, 'Pertemuan awal tidak boleh lebih besar dari pertemuan akhir.', 'error');
      return;
    }
    if (!getMeetingDeadline(meetingStart) || !getMeetingDeadline(meetingEnd)) {
      setMessage(message, 'Jadwal mata kuliah belum lengkap sehingga deadline otomatis tidak dapat dihitung.', 'error');
      return;
    }

    const groupSizes = Array.from({ length: groupCount }, (_, index) => Math.floor(allNames.length / groupCount) + (index < allNames.length % groupCount ? 1 : 0));
    const groups = groupSizes.map((capacity, index) => ({
      name: `${fields.groupPrefix.value.trim() || 'Kelompok'} ${index + 1}`,
      capacity,
      members: [],
      male: 0,
      female: 0,
    }));
    distributeNames(groups, maleNames, 'male');
    distributeNames(groups, femaleNames, 'female');
    const meetings = randomMeetings(groupCount, meetingStart, meetingEnd);
    generatedPlan = {
      courseId: managedCourse.id,
      groups: groups.map((group, index) => {
        const meeting = meetings[index];
        return { ...group, meeting, dueAt: getMeetingDeadline(meeting)?.toISOString() || null };
      }),
    };
    renderGeneratedPlan();
    setMessage(message, 'Kelompok berhasil diacak. Periksa pratinjau, atau acak ulang bila diperlukan.', 'success');
  }

  function renderGeneratedPlan() {
    const panel = root.querySelector('#generatedGroupsPanel');
    const summary = root.querySelector('#generatedGroupsSummary');
    const list = root.querySelector('#generatedGroupsList');
    const totalMembers = generatedPlan.groups.reduce((total, group) => total + group.members.length, 0);
    summary.textContent = `${generatedPlan.groups.length} kelompok · ${totalMembers} mahasiswa · masing-masing akan dibuat menjadi satu tugas kelompok.`;
    list.innerHTML = generatedPlan.groups.map(group => `
      <article class="random-group-card">
        <div class="random-group-heading"><h3>${escapeHTML(group.name)}</h3><span>Pertemuan ke-${group.meeting}</span></div>
        <p>${group.members.map(member => escapeHTML(member.name)).join(', ')}</p>
        <small>Deadline ${escapeHTML(formatDeadline(group.dueAt))} · ${group.male} laki-laki · ${group.female} perempuan · ${group.members.length} anggota</small>
      </article>
    `).join('');
    panel.hidden = false;
    root.querySelector('#saveGeneratedGroups').disabled = false;
  }

  function setupBulkSaveDialog() {
    const dialog = root.querySelector('#bulkSaveDialog');
    const form = root.querySelector('#bulkSaveForm');
    root.querySelectorAll('[data-close-bulk-dialog]').forEach(button => button.addEventListener('click', () => dialog.close()));
    dialog.addEventListener('close', () => {
      form.reset();
      setMessage(root.querySelector('#bulkSaveMessage'), '');
    });
    form.addEventListener('submit', confirmBulkSave);
  }

  function openBulkSaveDialog() {
    if (!generatedPlan?.groups.length) return;
    root.querySelector('#bulkSaveDescription').textContent = `Simpan ${generatedPlan.groups.length} kelompok dan ${generatedPlan.groups.length} tugas kelompok untuk ${managedCourse.name}. Masukkan password untuk melanjutkan.`;
    root.querySelector('#bulkSaveDialog').showModal();
    root.querySelector('#bulkSaveDialog input[name="password"]').focus();
  }

  async function verifyCurrentPassword(password) {
    const { data: { user }, error: userError } = await client.auth.getUser();
    if (userError || !user?.email) return { error: 'Sesi akun tidak valid. Silakan masuk kembali.' };
    const { error } = await client.auth.signInWithPassword({ email: user.email, password });
    return { error: error ? 'Password akun tidak sesuai.' : null };
  }

  async function confirmBulkSave(event) {
    event.preventDefault();
    if (!generatedPlan?.groups.length) return;
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const message = root.querySelector('#bulkSaveMessage');
    button.disabled = true;
    button.textContent = 'Memeriksa…';
    setMessage(message, '');
    const { error } = await verifyCurrentPassword(form.elements.password.value);
    if (error) {
      setMessage(message, error, 'error');
      button.disabled = false;
      button.textContent = 'Verifikasi & simpan semua';
      return;
    }
    root.querySelector('#bulkSaveDialog').close();
    await saveGeneratedPlan();
  }

  async function createGroupTask(group) {
    const { data: savedGroup, error: groupError } = await client
      .from('groups')
      .insert({ course_id: generatedPlan.courseId, name: group.name, progress: 0 })
      .select('id')
      .single();
    if (groupError) throw new Error(`Kelompok “${group.name}” belum tersimpan: ${groupError.message}`);

    const { error: membersError } = await client.from('group_members').insert(
      group.members.map(member => ({ group_id: savedGroup.id, name: member.name, student_id: findStudentProfile(member.name).user_id })),
    );
    if (membersError) {
      await client.from('groups').delete().eq('id', savedGroup.id);
      throw new Error(`Anggota ${group.name} belum tersimpan: ${membersError.message}`);
    }

    const { data: savedTask, error: taskError } = await client
      .from('tasks')
      .insert({
        course_id: generatedPlan.courseId,
        type: 'kelompok',
        title: `Tugas ${group.name}`,
        description: '',
        due_at: group.dueAt,
        meeting: group.meeting,
        checklist: [],
        submission: '',
        group_id: savedGroup.id,
      })
      .select('id')
      .single();
    if (taskError) {
      await client.from('groups').delete().eq('id', savedGroup.id);
      throw new Error(`Tugas ${group.name} belum tersimpan: ${taskError.message}`);
    }
    return { groupId: savedGroup.id, taskId: savedTask.id };
  }

  async function cleanUpSavedData(savedItems) {
    await Promise.all(savedItems.map(item => client.from('tasks').delete().eq('id', item.taskId)));
    await Promise.all(savedItems.map(item => client.from('groups').delete().eq('id', item.groupId)));
  }

  async function saveGeneratedPlan() {
    const form = root.querySelector('#groupRandomizerForm');
    const message = root.querySelector('#randomizerMessage');
    const saveButton = root.querySelector('#saveGeneratedGroups');
    const generateButton = root.querySelector('#generateGroups');
    const savedItems = [];
    saveButton.disabled = true;
    generateButton.disabled = true;
    saveButton.textContent = 'Menyimpan…';
    setMessage(message, `Menyimpan ${generatedPlan.groups.length} kelompok dan tugas…`);

    try {
      for (const group of generatedPlan.groups) {
        savedItems.push(await createGroupTask(group));
      }
    } catch (error) {
      await cleanUpSavedData(savedItems);
      setMessage(message, error.message, 'error');
      saveButton.disabled = false;
      generateButton.disabled = false;
      saveButton.textContent = 'Simpan semua tugas →';
      return;
    }

    const savedCount = generatedPlan.groups.length;
    generatedPlan = null;
    form.reset();
    root.querySelector('#generatedGroupsPanel').hidden = true;
    root.querySelector('#generatedGroupsList').innerHTML = '';
    saveButton.disabled = true;
    generateButton.disabled = false;
    saveButton.textContent = 'Simpan semua tugas →';
    setMessage(message, `${savedCount} kelompok dan ${savedCount} tugas kelompok berhasil disimpan.`, 'success');
  }

  async function loadManagedCourse() {
    const { data: hasAccess, error: accessError } = await client.rpc('has_course_access');
    if (accessError || !hasAccess) {
      root.innerHTML = '<div class="error-card"><strong>Akun belum memiliki akses mata kuliah.</strong><p>Masuklah melalui halaman Admin menggunakan akun pengelola yang sesuai.</p><a class="button button-primary" href="index.html">Ke halaman admin</a></div>';
      return;
    }
    const [{ data: courses, error: coursesError }, { data: assignments, error: assignmentsError }, { error: groupsError }, { data: profiles, error: profilesError }] = await Promise.all([
      client.from('courses').select('id, name').order('name'),
      client.from('course_admins').select('course_id'),
      client.from('groups').select('id').limit(1),
      client.from('student_profiles').select('user_id, nim, full_name').order('full_name'),
    ]);
    if (coursesError || assignmentsError || profilesError) {
      root.innerHTML = '<div class="error-card"><strong>Data mata kuliah belum dapat dimuat.</strong><p>Silakan muat ulang halaman atau kembali ke Admin.</p><a class="button button-primary" href="index.html">Ke halaman admin</a></div>';
      return;
    }
    studentProfiles = profiles || [];
    const managedCourseIds = new Set((assignments || []).map(assignment => assignment.course_id));
    managedCourses = (courses || [])
      .filter(course => managedCourseIds.has(course.id))
      .map(course => ({ ...(courseDetailsById.get(course.id) || {}), ...course }));
    managedCourse = managedCourses[0] || null;
    if (!managedCourse) {
      root.innerHTML = '<div class="error-card"><strong>Akun belum terhubung ke mata kuliah.</strong><p>Periksa pemetaan akun pada tabel course_admins di Supabase.</p><a class="button button-primary" href="index.html">Ke halaman admin</a></div>';
      return;
    }
    if (groupsError) {
      root.innerHTML = '<div class="error-card"><strong>Fitur kelompok belum disiapkan di database.</strong><p>Jalankan <code>supabase-groups-setup.sql</code>, kemudian muat ulang halaman.</p><a class="button button-primary" href="index.html">Ke halaman admin</a></div>';
      return;
    }
    renderPage();
  }

  async function start() {
    const { data: { session } } = await client.auth.getSession();
    if (!session) {
      root.innerHTML = '<div class="error-card"><strong>Masuk terlebih dahulu.</strong><p>Halaman pengacak hanya tersedia untuk akun pengelola.</p><a class="button button-primary" href="index.html">Masuk ke admin</a></div>';
      return;
    }
    await loadManagedCourse();
  }

  start();
})();
