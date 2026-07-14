/**
 * SMA_BACKEND.js  –  Firebase / Firestore Edition
 * First Pentagon College – Shared Firebase backend
 * All three portals (Admin, Teacher, Student) use this shared data layer.
 *
 * DROP-IN REPLACEMENT: Every public method has the same name and signature
 * as the original localStorage version, but now returns a Promise.
 * Portals must await every SMA call, e.g.:
 *   const students = await SMA.getStudents();
 *
 * Firebase SDK v12 is loaded via CDN (compat / global build).
 * Add these two scripts BEFORE this file in every portal's <head>:
 *
 *   <script src="firebase-config.js"></script>
 *   <script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js"></script>
 *   <script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js"></script>
 *   <script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js"></script>
 *   <script src="sma_backend.js"></script>
 *
 * Firestore collections mirror the old localStorage keys:
 *   users | students | teachers | lesson_plans | lesson_notes | payments |
 *   announcements | settings  | activity | results | assignments |
 *   class_notes   | timetable | fees | notifications | payment_proofs | presence
 */

window.SMA = (() => {

  /* ═══════════ FIREBASE INIT ═══════════ */
  const firebaseConfig = window.FIREBASE_CONFIG;

  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  const db = firebase.firestore();

  /* ═══════════ FIRESTORE HELPERS ═══════════ */
  // Collection references
  const col = name => db.collection(name);

  // Get a single document as plain JS object (returns null if missing)
  async function getDoc(collection, docId) {
    const snap = await col(collection).doc(docId).get();
    return snap.exists ? snap.data() : null;
  }

  // Set / overwrite a document
  async function setDoc(collection, docId, data) {
    await col(collection).doc(docId).set(data);
    return true;
  }

  // ─── Ordered array documents stored as a single doc ───────────────────────
  // We store arrays (students, teachers, payments, etc.) as a single Firestore
  // document with a field called "items". This keeps the API identical to the
  // old localStorage approach and avoids per-record listener complexity.
  async function loadList(name) {
    const doc = await getDoc('lists', name);
    return doc ? (doc.items || []) : [];
  }
  async function saveList(name, arr) {
    await setDoc('lists', name, { items: arr, updatedAt: new Date().toISOString() });
    return true;
  }

  // Key map (mirrors old KEY constant for readability)
  const KEY = {
    USERS:          'users',
    STUDENTS:       'students',
    TEACHERS:       'teachers',
    LESSON_PLANS:   'lesson_plans',
    LESSON_NOTES:   'lesson_notes',
    PAYMENTS:       'payments',
    ANNOUNCEMENTS:  'announcements',
    SETTINGS:       'settings',
    ACTIVITY:       'activity',
    RESULTS:        'results',
    ASSIGNMENTS:    'assignments',
    CLASS_NOTES:    'class_notes',
    TIMETABLE:      'timetable',
    FEES:           'fees',
    NOTIFICATIONS:  'notifications',
    PAYMENT_PROOFS: 'payment_proofs',
    PRESENCE:       'presence',
    DOMAIN_APPROVALS: 'domain_approvals',
  };

  /* ═══════════ SEED DEFAULTS ═══════════ */
  // _seeded: true once Firestore confirms data is present.
  // _seedingPromise: shared Promise while a seed is in-flight, so concurrent
  //   callers await the same operation instead of each launching their own.
  let _seeded = false;
  let _seedingPromise = null;
  async function seedDefaults() {
    if (_seeded) return;
    if (_seedingPromise) return _seedingPromise; // reuse in-flight seed
    _seedingPromise = _doSeed().finally(() => { _seedingPromise = null; });
    return _seedingPromise;
  }
  async function _doSeed() {
    try {
      const users = await getDoc('config', 'users');
      if (users) { _seeded = true; return; } // already seeded in Firestore

      // Admin user — password stored as SHA-256 hash
      const hashedAdminPw = await hashPassword('FPC@Admin2025!');
      await setDoc('config', 'users', {
        admin: { role: 'admin', username: 'admin', password: hashedAdminPw, name: 'F.P.C Admin', email: 'firstpentagoncollege01@gmail.com', mustChangePassword: true }
      });

      // Settings
      await setDoc('config', 'settings', {
        schoolName: 'First Pentagon College',
        address:    '12 Academy Road, Lagos, Nigeria',
        session:    '2025/2026',
        term:       'Third Term',
        email:      'firstpentagoncollege01@gmail.com',
        phone:      '+234 801 234 5678',
        fees: { PrePrimary: 45000, Primary: 45000, JSS: 55000, SSS: 65000 }
      });

      // Empty lists
      const emptyLists = [
        KEY.STUDENTS, KEY.TEACHERS, KEY.LESSON_PLANS, KEY.LESSON_NOTES,
        KEY.CLASS_NOTES, KEY.ASSIGNMENTS, KEY.TIMETABLE, KEY.PAYMENTS,
        KEY.ANNOUNCEMENTS, KEY.ACTIVITY, KEY.NOTIFICATIONS, KEY.DOMAIN_APPROVALS,
      ];
      await Promise.all(emptyLists.map(name => saveList(name, [])));

      // Results map
      await setDoc('config', 'results', {});

      // Presence map
      await setDoc('config', 'presence', {});
      _seeded = true;
    } catch(e) {
      console.warn('F.P.C _doSeed skipped (Firestore may need rules):', e.message || e);
    }
  }

  /* ═══════════ AUTH ═══════════ */
  async function hashPassword(plain) {
    const enc = new TextEncoder();
    const buf = await crypto.subtle.digest('SHA-256', enc.encode(plain));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function login(role, username, password) {
    try {
      await seedDefaults();

      if (role === 'admin') {
        const users = await getDoc('config', 'users') || {};
        const u = users[username];
        const hashed = await hashPassword(password);
        const match = u && u.password === hashed;
        if (match && u.role === 'admin') return { ok: true, user: u };
        return { ok: false, msg: 'Invalid admin credentials.' };
      }
      const hashed = await hashPassword(password);
      if (role === 'teacher') {
        const teachers = await loadList(KEY.TEACHERS);
        const t = teachers.find(t => t.username.toLowerCase() === username.toLowerCase() && t.password === hashed);
        if (t) return { ok: true, user: { ...t, role: 'teacher' } };
        return { ok: false, msg: 'Invalid teacher credentials.' };
      }
      if (role === 'student') {
        const students = await loadList(KEY.STUDENTS);
        const s = students.find(s => s.username.toLowerCase() === username.toLowerCase() && s.password === hashed);
        if (s) return { ok: true, user: { ...s, role: 'student' } };
        return { ok: false, msg: 'Invalid student credentials.' };
      }
      return { ok: false, msg: 'Unknown role.' };
    } catch(e) {
      console.error('F.P.C login error:', e);
      return { ok: false, msg: 'Connection error: ' + (e.message || 'Could not reach database. Check Firestore security rules.') };
    }
  }

  /* ═══════════ STUDENTS ═══════════ */
  async function getStudents() {
    await seedDefaults();
    return loadList(KEY.STUDENTS);
  }
  async function saveStudents(arr) { return saveList(KEY.STUDENTS, arr); }
  async function addStudent(data) {
    const students = await getStudents();
    // Use timestamp + random suffix so IDs stay unique even after deletions.
    // The old length-based prefix caused collisions when a student was removed
    // and a new one was added (e.g. delete #5 → next add also gets STU005_…).
    const id = 'STU_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const section = ['Play Group','Nursery 1','Nursery 2','Kindergarten'].includes(data.class) ? 'PrePrimary' : data.class.startsWith('Primary') ? 'Primary' : data.class.startsWith('JSS') ? 'JSS' : 'SSS';
    const settings = await getSettings();
    const feeDue = settings.fees[section] || (section === 'PrePrimary' ? 45000 : section === 'Primary' ? 45000 : section === 'JSS' ? 55000 : 65000);
    const username = (data.firstName.toLowerCase() + '.' + data.lastName.toLowerCase()).replace(/\s+/g, '');
    const plainPassword = 'fpc@' + data.firstName.toLowerCase().replace(/\s+/g, '');
    const password = await hashPassword(plainPassword);
    const student = { id, ...data, username, password, fee: 'Unpaid', feePaid: 0, feeDue, grade: 0, admissionDate: new Date().toISOString().split('T')[0] };
    students.push(student);
    await saveList(KEY.STUDENTS, students);
    await logActivity(`New student registered: ${data.firstName} ${data.lastName} – ${data.class}`, '🎓', 'info');
    return student;
  }
  async function updateStudent(id, data, opts = {}) {
    const students = await getStudents();
    const idx = students.findIndex(s => s.id === id);
    if (idx === -1) return false;
    const before = students[idx];
    const merged = { ...before, ...data };
    // If the name changed, regenerate the username & default password to match
    // it (same pattern used at registration), so login credentials stay in
    // sync with the student's current name instead of going stale.
    const nameChanged = opts.forceSync || (data.firstName !== undefined && data.firstName !== before.firstName) ||
                         (data.lastName  !== undefined && data.lastName  !== before.lastName);
    if (nameChanged && merged.firstName && merged.lastName) {
      const base = (merged.firstName.toLowerCase() + '.' + merged.lastName.toLowerCase()).replace(/\s+/g, '');
      let newUsername = base, n = 2;
      while (students.some((s, i) => i !== idx && (s.username || '').toLowerCase() === newUsername)) {
        newUsername = base + (n++);
      }
      merged.username = newUsername;
      const plainPassword = 'fpc@' + merged.firstName.toLowerCase().replace(/\s+/g, '');
      merged.password = await hashPassword(plainPassword);
      if ('defaultPassword' in merged) merged.defaultPassword = plainPassword;
    }
    students[idx] = merged;
    return saveList(KEY.STUDENTS, students);
  }
  async function removeStudent(id) {
    const students = (await getStudents()).filter(s => s.id !== id);
    await logActivity(`Student removed (${id})`, '🗑️', 'danger');
    return saveList(KEY.STUDENTS, students);
  }

  /* ═══════════ TEACHERS ═══════════ */
  async function getTeachers() {
    await seedDefaults();
    return loadList(KEY.TEACHERS);
  }
  async function saveTeachers(arr) { return saveList(KEY.TEACHERS, arr); }
  async function addTeacher(data) {
    const teachers = await getTeachers();
    // Use timestamp + random suffix — same reason as addStudent above.
    const id = 'TCH_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const username = (data.firstName.toLowerCase() + '.' + data.lastName.toLowerCase()).replace(/\s+/g, '');
    const plainPassword = 'fpc@' + data.firstName.toLowerCase().replace(/\s+/g, '');
    const password = await hashPassword(plainPassword);
    const teacher = { id, ...data, username, password, status: 'Active' };
    teachers.push(teacher);
    await saveList(KEY.TEACHERS, teachers);
    await logActivity(`Teacher account created: ${data.firstName} ${data.lastName}`, '👩‍🏫', 'purple');
    return teacher;
  }
  async function updateTeacher(id, data, opts = {}) {
    const teachers = await getTeachers();
    const idx = teachers.findIndex(t => t.id === id);
    if (idx === -1) return false;
    const before = teachers[idx];
    const merged = { ...before, ...data };
    // If the name changed, regenerate the username & default password to match
    // it (same pattern used at registration), so login credentials stay in
    // sync with the teacher's current name instead of going stale.
    const nameChanged = opts.forceSync || (data.firstName !== undefined && data.firstName !== before.firstName) ||
                         (data.lastName  !== undefined && data.lastName  !== before.lastName);
    if (nameChanged && merged.firstName && merged.lastName) {
      const base = (merged.firstName.toLowerCase() + '.' + merged.lastName.toLowerCase()).replace(/\s+/g, '');
      let newUsername = base, n = 2;
      while (teachers.some((t, i) => i !== idx && (t.username || '').toLowerCase() === newUsername)) {
        newUsername = base + (n++);
      }
      merged.username = newUsername;
      const plainPassword = 'fpc@' + merged.firstName.toLowerCase().replace(/\s+/g, '');
      merged.password = await hashPassword(plainPassword);
      if ('defaultPassword' in merged) merged.defaultPassword = plainPassword;
    }
    teachers[idx] = merged;
    return saveList(KEY.TEACHERS, teachers);
  }
  async function removeTeacher(id) {
    const teachers = (await getTeachers()).filter(t => t.id !== id);
    await logActivity(`Teacher removed (${id})`, '🗑️', 'danger');
    return saveList(KEY.TEACHERS, teachers);
  }

  /* ═══════════ LESSON PLANS ═══════════ */
  async function getLessonPlans() {
    await seedDefaults();
    return loadList(KEY.LESSON_PLANS);
  }
  async function addLessonPlan(data) {
    const plans = await getLessonPlans();
    const id = 'LP_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const plan = { id, ...data, status: 'Pending', date: new Date().toISOString().split('T')[0] };
    plans.unshift(plan);
    await saveList(KEY.LESSON_PLANS, plans);
    await logActivity(`Lesson plan submitted by ${data.teacher} – ${data.subject}`, '📋', 'warning');
    return plan;
  }
  async function updatePlanStatus(id, status, comment) {
    const plans = await getLessonPlans();
    const idx = plans.findIndex(p => p.id === id);
    if (idx === -1) return false;
    plans[idx].status = status;
    if (comment) plans[idx].adminComment = comment;
    await saveList(KEY.LESSON_PLANS, plans);
    await logActivity(`Lesson plan ${status.toLowerCase()}: ${plans[idx].title}`, status === 'Approved' ? '✅' : '❌', status === 'Approved' ? 'success' : 'danger');
    return true;
  }
  async function deleteLessonPlan(id) {
    const plans = await getLessonPlans();
    const plan = plans.find(p => p.id === id);
    if (!plan) return false;
    await saveList(KEY.LESSON_PLANS, plans.filter(p => p.id !== id));
    await logActivity(`Lesson plan deleted: ${plan.title} (was ${plan.status})`, '🗑️', 'danger');
    return true;
  }
  async function undoPlanStatus(id) {
    const plans = await getLessonPlans();
    const idx = plans.findIndex(p => p.id === id);
    if (idx === -1) return false;
    const prevStatus = plans[idx].status;
    plans[idx].status = 'Pending';
    delete plans[idx].adminComment;
    await saveList(KEY.LESSON_PLANS, plans);
    await logActivity(`Lesson plan decision undone (was ${prevStatus}): ${plans[idx].title}`, '↩️', 'warning');
    return true;
  }

  /* ═══════════ LESSON NOTES ═══════════ */
  async function getLessonNotes() {
    await seedDefaults();
    return loadList(KEY.LESSON_NOTES);
  }
  async function addLessonNote(data) {
    const notes = await getLessonNotes();
    const id = 'LN_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const note = { id, ...data, status: 'Pending', date: new Date().toISOString().split('T')[0] };
    notes.unshift(note);
    await saveList(KEY.LESSON_NOTES, notes);
    await logActivity(`Lesson note submitted by ${data.teacher} – ${data.subject}`, '📝', 'info');
    return note;
  }
  async function updateNoteStatus(id, status, comment) {
    const notes = await getLessonNotes();
    const idx = notes.findIndex(n => n.id === id);
    if (idx === -1) return false;
    notes[idx].status = status;
    if (comment) notes[idx].adminComment = comment;
    await saveList(KEY.LESSON_NOTES, notes);
    return true;
  }
  async function deleteLessonNote(id) {
    const notes = await getLessonNotes();
    const note = notes.find(n => n.id === id);
    if (!note) return false;
    await saveList(KEY.LESSON_NOTES, notes.filter(n => n.id !== id));
    await logActivity(`Lesson note deleted: ${note.title} (was ${note.status})`, '🗑️', 'danger');
    return true;
  }
  async function undoNoteStatus(id) {
    const notes = await getLessonNotes();
    const idx = notes.findIndex(n => n.id === id);
    if (idx === -1) return false;
    const prevStatus = notes[idx].status;
    notes[idx].status = 'Pending';
    delete notes[idx].adminComment;
    await saveList(KEY.LESSON_NOTES, notes);
    await logActivity(`Lesson note decision undone (was ${prevStatus}): ${notes[idx].title}`, '↩️', 'warning');
    return true;
  }

  /* ═══════════ DOMAIN APPROVALS (Affective & Psychomotor) ═══════════
   * Flow:
   *   1. Teacher rates a student's behavioural/psychomotor traits and submits
   *      via submitDomainApproval() — this only writes a Pending record here,
   *      it does NOT touch the student's live results/report card yet.
   *   2. Admin reviews pending submissions and calls updateDomainApprovalStatus()
   *      with 'Approved' or 'Declined'.
   *   3. On Approval, the ratings are merged into the student's results record
   *      (same shape the report card already reads), making them visible on
   *      the report card. On Decline, nothing is written to results.
   */
  async function getDomainApprovals() {
    await seedDefaults();
    return loadList(KEY.DOMAIN_APPROVALS);
  }
  async function submitDomainApproval(data) {
    const list = await getDomainApprovals();
    const id = 'DOM_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const record = { id, ...data, status: 'Pending', date: new Date().toISOString().split('T')[0] };
    list.unshift(record);
    await saveList(KEY.DOMAIN_APPROVALS, list);
    await logActivity(`Domain ratings submitted by ${data.teacher} for ${data.studentName}`, '🧠', 'warning');
    return record;
  }
  async function updateDomainApprovalStatus(id, status, comment) {
    const list = await getDomainApprovals();
    const idx = list.findIndex(d => d.id === id);
    if (idx === -1) return false;
    list[idx].status = status;
    if (comment) list[idx].adminComment = comment;
    list[idx].reviewedAt = new Date().toISOString();
    const rec = list[idx];

    if (status === 'Approved') {
      // Merge the approved ratings into the student's results (report card).
      const existing = await getResults(rec.studentId);
      let records = existing && existing.length ? existing : [];
      if (records.length) {
        records = records.map((r, i) => i === 0 ? {
          ...r,
          behaviouralRatings: { ...(r.behaviouralRatings || {}), ...(rec.behaviouralRatings || {}) },
          psychomotorRatings: { ...(r.psychomotorRatings || {}), ...(rec.psychomotorRatings || {}) },
          ...(rec.teacherComment !== undefined ? { teacherComment: rec.teacherComment } : {}),
          ...(rec.teacherName !== undefined ? { teacherName: rec.teacherName } : {}),
        } : r);
      } else {
        records = [{
          behaviouralRatings: rec.behaviouralRatings || {},
          psychomotorRatings: rec.psychomotorRatings || {},
          teacherComment: rec.teacherComment || '',
          teacherName: rec.teacherName || '',
          studentName: rec.studentName,
          class: rec.class,
          teacher: rec.teacher,
          savedAt: new Date().toISOString(),
        }];
      }
      await saveResult(rec.studentId, records);
    }

    await saveList(KEY.DOMAIN_APPROVALS, list);
    await logActivity(`Domain ratings ${status.toLowerCase()} for ${rec.studentName}`, status === 'Approved' ? '✅' : '❌', status === 'Approved' ? 'success' : 'danger');
    return true;
  }
  async function deleteDomainApproval(id) {
    const list = await getDomainApprovals();
    const rec = list.find(d => d.id === id);
    if (!rec) return false;
    await saveList(KEY.DOMAIN_APPROVALS, list.filter(d => d.id !== id));
    await logActivity(`Domain rating submission deleted for ${rec.studentName} (was ${rec.status})`, '🗑️', 'danger');
    return true;
  }
  async function undoDomainApprovalStatus(id) {
    const list = await getDomainApprovals();
    const idx = list.findIndex(d => d.id === id);
    if (idx === -1) return false;
    const rec = list[idx];
    const prevStatus = rec.status;

    if (prevStatus === 'Approved') {
      // The approval had merged these ratings into the student's results/report
      // card — strip just those trait keys back out so undo doesn't leave stale
      // approved data visible on the report card.
      try {
        const existing = await getResults(rec.studentId);
        if (existing && existing.length) {
          const records = existing.map((r, i) => {
            if (i !== 0) return r;
            const copy = { ...r };
            if (copy.behaviouralRatings) {
              const beh = { ...copy.behaviouralRatings };
              Object.keys(rec.behaviouralRatings || {}).forEach(k => delete beh[k]);
              copy.behaviouralRatings = beh;
            }
            if (copy.psychomotorRatings) {
              const psy = { ...copy.psychomotorRatings };
              Object.keys(rec.psychomotorRatings || {}).forEach(k => delete psy[k]);
              copy.psychomotorRatings = psy;
            }
            if (rec.teacherComment !== undefined && copy.teacherComment === rec.teacherComment) {
              delete copy.teacherComment;
            }
            if (rec.teacherName !== undefined && copy.teacherName === rec.teacherName) {
              delete copy.teacherName;
            }
            return copy;
          });
          await saveResult(rec.studentId, records);
        }
      } catch (e) { console.error('undoDomainApprovalStatus: failed to strip merged ratings', e); }
    }

    rec.status = 'Pending';
    delete rec.adminComment;
    delete rec.reviewedAt;
    await saveList(KEY.DOMAIN_APPROVALS, list);
    await logActivity(`Domain rating decision undone (was ${prevStatus}) for ${rec.studentName}`, '↩️', 'warning');
    return true;
  }

  /* ═══════════ CLASS NOTES ═══════════ */
  async function getClassNotes() {
    await seedDefaults();
    return loadList(KEY.CLASS_NOTES);
  }
  async function addClassNote(data) {
    const notes = await getClassNotes();
    const id = 'CN' + String(notes.length + 1).padStart(3, '0') + '_' + Date.now();
    const note = { id, ...data, date: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) };
    notes.unshift(note);
    await saveList(KEY.CLASS_NOTES, notes);
    await addNotification({
      type: 'class_note', refId: id, targetClass: data.targetClass || null,
      title: `📚 New Class Note: ${data.subject || 'Note'}`,
      summary: (data.content || data.preview || '').substring(0, 160),
      content: data.content || data.preview || '',
      teacher: data.teacher || 'Teacher', subject: data.subject || '', term: data.term || '',
    });
    const classLabel = data.targetClass ? ' – ' + data.targetClass : '';
    await logActivity(`Class note shared by ${data.teacher || 'Teacher'} – ${data.subject || 'Note'}${classLabel}`, '📚', 'info');
    return note;
  }

  /* ═══════════ ASSIGNMENTS ═══════════ */
  async function getAssignments() {
    await seedDefaults();
    return loadList(KEY.ASSIGNMENTS);
  }
  async function saveAssignments(arr) { return saveList(KEY.ASSIGNMENTS, arr); }
  async function removeAssignment(id) {
    const assignments = (await getAssignments()).filter(a => String(a.id) !== String(id));
    return saveList(KEY.ASSIGNMENTS, assignments);
  }
  async function removeClassNote(id) {
    const notes = (await getClassNotes()).filter(n => String(n.id) !== String(id));
    return saveList(KEY.CLASS_NOTES, notes);
  }
  /**
   * cleanupExpiredContent()
   * Removes assignments and class notes whose dueDate has passed (i.e. is before today).
   * Call this on portal load so students never see overdue content.
   * Returns { removedAssignments: number, removedNotes: number }
   */
  async function cleanupExpiredContent() {
    const today = new Date();
    today.setHours(0, 0, 0, 0); // start of today

    const [assignments, notes] = await Promise.all([getAssignments(), getClassNotes()]);

    const validAssignments = assignments.filter(a => {
      if (!a.dueDate) return true; // no deadline = keep forever
      const due = new Date(a.dueDate);
      due.setHours(0, 0, 0, 0);
      return due >= today; // keep if deadline is today or future
    });

    const validNotes = notes.filter(n => {
      if (!n.dueDate) return true;
      const due = new Date(n.dueDate);
      due.setHours(0, 0, 0, 0);
      return due >= today;
    });

    const removedAssignments = assignments.length - validAssignments.length;
    const removedNotes = notes.length - validNotes.length;

    if (removedAssignments > 0) await saveList(KEY.ASSIGNMENTS, validAssignments);
    if (removedNotes > 0) await saveList(KEY.CLASS_NOTES, validNotes);

    return { removedAssignments, removedNotes };
  }
  async function addAssignment(data) {
    const assignments = await getAssignments();
    const id = 'ASN' + String(assignments.length + 1).padStart(3, '0') + '_' + Date.now();
    const a = { id, ...data, postedDate: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) };
    assignments.unshift(a);
    await saveList(KEY.ASSIGNMENTS, assignments);
    await addNotification({
      type: 'assignment', refId: id, targetClass: data.targetClass || null,
      title: `📝 New Assignment: ${data.subject || 'Assignment'}`,
      summary: (data.description || '').substring(0, 160),
      content: data.description || '',
      teacher: data.teacher || 'Teacher', subject: data.subject || '',
      dueDate: data.dueDate || '', term: data.term || '',
    });
    const isClasswork = (data.type || '').toLowerCase() === 'classwork';
    const classLabel = data.targetClass ? ' – ' + data.targetClass : '';
    const dueLabel = data.dueDate ? ' (Due: ' + data.dueDate + ')' : '';
    if (isClasswork) {
      await logActivity(`Classwork set by ${data.teacher || 'Teacher'} – ${data.subject || 'Classwork'}${classLabel}`, '✏️', 'info');
    } else {
      await logActivity(`Assignment posted by ${data.teacher || 'Teacher'} – ${data.subject || 'Assignment'}${classLabel}${dueLabel}`, '📌', 'info');
    }
    return a;
  }

  /* ═══════════ NOTIFICATIONS ═══════════ */
  async function getNotifications() {
    await seedDefaults();
    return loadList(KEY.NOTIFICATIONS);
  }
  async function addNotification(data) {
    const notifs = await getNotifications();
    const id = 'NTF' + Date.now();
    const notif = {
      id, ...data,
      postedDate: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
      postedAt: new Date().toISOString(),
    };
    notifs.unshift(notif);
    if (notifs.length > 200) notifs.pop();
    await saveList(KEY.NOTIFICATIONS, notifs);
    return notif;
  }
  async function getStudentNotifications(studentClass, studentId) {
    const notifs = await getNotifications();
    return notifs.filter(n => {
      // Notifications addressed to a specific student (e.g. delete approved/declined)
      if (n.targetStudentId) return n.targetStudentId === studentId;
      // Otherwise filter by class restriction (or show to all if unrestricted)
      return !n.targetClass || n.targetClass === studentClass;
    });
  }
  /**
   * removeNotificationByRef(refId)
   * Removes all notifications whose refId matches the given content ID.
   * Call this whenever a class note or assignment is deleted so that the
   * corresponding notification disappears from students' feeds immediately.
   */
  async function removeNotificationByRef(refId) {
    if (!refId) return false;
    const notifs = await getNotifications();
    const filtered = notifs.filter(n => String(n.refId) !== String(refId));
    if (filtered.length === notifs.length) return false; // nothing to remove
    return saveList(KEY.NOTIFICATIONS, filtered);
  }

  /* ═══════════ PAYMENTS ═══════════ */
  async function getPayments() {
    await seedDefaults();
    return loadList(KEY.PAYMENTS);
  }
  async function addPayment(data) {
    const payments = await getPayments();
    const id = 'PAY' + String(payments.length + 1).padStart(3, '0') + '_' + Date.now();
    const ref = 'FPC' + Date.now();
    const { screenshotProof, ...rest } = data;
    // FIX: Always store amount as a whole-number integer (Math.round) to prevent
    // floating-point imprecision from causing the admin portal to show e.g. 99,992
    // instead of 100,000. Any float drift introduced by Number() or upstream
    // arithmetic is eliminated here before the value reaches Firestore.
    const safeAmount = Math.round(Number(rest.amount) || 0);
    const payment = { id, ...rest, amount: safeAmount, ref, date: new Date().toISOString().split('T')[0], status: 'Pending', hasProof: !!screenshotProof };
    payments.unshift(payment);
    await saveList(KEY.PAYMENTS, payments);
    if (screenshotProof) {
      // Store each proof as its own doc to avoid Firestore 1MB single-doc limit
      await setDoc('proofs', id, { data: screenshotProof, paymentId: id });
    }
    await logActivity(`Payment submitted: ${data.student} – ₦${data.amount.toLocaleString()}`, '💳', 'warning');
    return payment;
  }
  async function getPaymentProof(paymentId) {
    const doc = await getDoc('proofs', paymentId);
    return doc ? doc.data : null;
  }
  async function deletePaymentProof(paymentId) {
    await col('proofs').doc(paymentId).delete();
  }
  async function confirmPayment(id) {
    const payments = await getPayments();
    const idx = payments.findIndex(p => p.id === id);
    if (idx === -1) return false;
    const pay = payments[idx];
    if (pay.status === 'Confirmed') return false; // already confirmed — prevent double-crediting
    pay.status = 'Confirmed';
    pay.confirmedDate = new Date().toISOString().split('T')[0];
    await saveList(KEY.PAYMENTS, payments);
    const students = await getStudents();
    const student = students.find(s => s.id === pay.studentId);
    if (student) {
      // FIX: Use Math.round on both operands to eliminate any floating-point
      // imprecision from old records (e.g. amount stored as 99999.9999992).
      // This ensures feePaid is always a clean integer.
      student.feePaid = Math.min(
        Math.round(student.feePaid || 0) + Math.round(pay.amount || 0),
        Math.round(student.feeDue || 0)
      );
      student.fee = student.feePaid >= student.feeDue ? 'Paid' : student.feePaid > 0 ? 'Partial' : 'Unpaid';
      await updateStudent(student.id, student);
    }
    await logActivity(`Fee confirmed: ${pay.student} – ₦${pay.amount.toLocaleString()}`, '✅', 'success');
    return true;
  }
  async function rejectPayment(id) {
    const payments = await getPayments();
    const idx = payments.findIndex(p => p.id === id);
    if (idx === -1) return false;
    payments[idx].status = 'Rejected';
    await saveList(KEY.PAYMENTS, payments);
    await logActivity(`Payment rejected: ${payments[idx].student}`, '❌', 'danger');
    return true;
  }

  /* ═══════════ ANNOUNCEMENTS ═══════════ */
  async function getAnnouncements() {
    await seedDefaults();
    return loadList(KEY.ANNOUNCEMENTS);
  }
  async function addAnnouncement(data) {
    const anns = await getAnnouncements();
    const id = 'ANN' + Date.now();
    const resolvedAuthor = data.author || 'Admin';
    const resolvedSource = data.source || (data.author && data.author !== 'Admin' ? 'teacher' : 'admin');
    const ann = {
      id, ...data,
      date: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
      author: resolvedAuthor, source: resolvedSource, postedAt: new Date().toISOString()
    };
    anns.unshift(ann);
    await saveList(KEY.ANNOUNCEMENTS, anns);
    await logActivity(`New announcement posted: ${data.title}`, '📢', 'info');
    return ann;
  }
  async function removeAnnouncement(id) {
    const anns = (await getAnnouncements()).filter(a => a.id !== id);
    return saveList(KEY.ANNOUNCEMENTS, anns);
  }
  async function toggleAnnouncementPin(id) {
    const anns = await getAnnouncements();
    const idx = anns.findIndex(a => a.id === id);
    if (idx === -1) return false;
    anns[idx].pinned = !anns[idx].pinned;
    return saveList(KEY.ANNOUNCEMENTS, anns);
  }

  /* ═══════════ RESULTS ═══════════ */
  // Results are stored per-student in the 'results' collection (one doc per student).
  // This replaces the old single shared-map approach (config/results) which had a
  // read-modify-write race: two concurrent saves would silently overwrite each other.
  async function getResults(studentId) {
    await seedDefaults();
    // Try new per-student collection first, fall back to legacy shared map.
    const perStudent = await getDoc('results', studentId);
    if (perStudent) return perStudent.results || [];
    const legacy = await getDoc('config', 'results') || {};
    return legacy[studentId] || [];
  }
  async function saveResult(studentId, results) {
    // Atomic merge write — no read required, eliminates race condition.
    try {
      await db.collection('results').doc(studentId).set(
        { studentId, results, updatedAt: new Date().toISOString() },
        { merge: true }
      );
      return true;
    } catch(e) {
      console.error('saveResult failed:', e);
      return false;
    }
  }
  // Returns a flat map { studentId: [results] } across all students.
  // Reads from the per-student 'results' collection (preferred) and merges the
  // legacy config/results map so no data is missed during migration.
  async function getAllResults() {
    await seedDefaults();
    const map = {};
    try {
      // Per-student collection (new)
      const snap = await db.collection('results').get();
      snap.forEach(doc => {
        const data = doc.data();
        if (data.results) map[doc.id] = data.results;
      });
    } catch(e) { console.error('getAllResults (per-student snap):', e); }
    try {
      // Legacy shared map (fallback — include any IDs not already in map)
      const legacy = await getDoc('config', 'results') || {};
      Object.entries(legacy).forEach(([id, res]) => {
        if (!map[id]) map[id] = res;
      });
    } catch(e) { console.error('getAllResults (legacy):', e); }
    return map;
  }
  // Bulk-overwrites the legacy config/results map (used by backup restore).
  async function saveAllResults(allResultsMap) {
    return setDoc('config', 'results', allResultsMap);
  }

  /* ═══════════ WITHHELD / SEIZED RESULTS ═══════════ */
  // Independent of getAllResults()/saveResult() above. An admin can withhold
  // (seize) an individual student's result even after results are globally
  // released; the student portal then shows a "Result Seized" notice instead
  // of their report card until the entry is removed.
  // Stored as config/withheldResults = { [studentId]: { withheld, reason, withheldAt, withheldBy } }
  async function getWithheldResults() {
    return (await getDoc('config', 'withheldResults')) || {};
  }
  async function isResultWithheld(studentId) {
    const map = await getWithheldResults();
    const entry = map[studentId];
    return (entry && entry.withheld) ? entry : null;
  }
  async function setWithheldResult(studentId, reason, withheldBy) {
    try {
      await db.collection('config').doc('withheldResults').set(
        { [studentId]: { withheld: true, reason: reason || '', withheldAt: new Date().toISOString(), withheldBy: withheldBy || 'Admin' } },
        { merge: true }
      );
      await logActivity(`Result withheld for student ${studentId}${reason ? ': ' + reason : ''}`, '🔒', 'warning');
      return true;
    } catch(e) { console.error('setWithheldResult failed:', e); return false; }
  }
  async function releaseWithheldResult(studentId) {
    try {
      await db.collection('config').doc('withheldResults').set(
        { [studentId]: firebase.firestore.FieldValue.delete() }, { merge: true }
      );
      await logActivity(`Result released back to student ${studentId}`, '🔓', 'success');
      return true;
    } catch(e) { console.error('releaseWithheldResult failed:', e); return false; }
  }

  /* ═══════════ SETTINGS ═══════════ */
  async function getSettings() {
    await seedDefaults();
    return (await getDoc('config', 'settings')) || {};
  }
  async function saveSettings(data) {
    const previous = await getSettings();
    await setDoc('config', 'settings', data);

    // If the fee schedule changed, propagate the new amounts to every
    // student's feeDue (and recompute their Paid/Partial/Unpaid status)
    // so the student portal reflects the update immediately, instead of
    // students staying stuck with the fee amount frozen at registration.
    const oldFees = previous.fees || {};
    const newFees = data.fees || {};
    const feesChanged = ['PrePrimary', 'Primary', 'JSS', 'SSS']
      .some(sec => (oldFees[sec] || 0) !== (newFees[sec] || 0));
    if (feesChanged) {
      const students = await getStudents();
      let touched = false;
      const updated = students.map(s => {
        const section = ['Play Group','Nursery 1','Nursery 2','Kindergarten'].includes(s.class) ? 'PrePrimary'
          : (s.class || '').startsWith('Primary') ? 'Primary'
          : (s.class || '').startsWith('JSS') ? 'JSS' : 'SSS';
        const newDue = newFees[section];
        if (newDue == null || newDue === s.feeDue) return s;
        touched = true;
        const feePaid = s.feePaid || 0;
        return {
          ...s,
          feeDue: newDue,
          fee: feePaid >= newDue ? 'Paid' : feePaid > 0 ? 'Partial' : 'Unpaid',
        };
      });
      if (touched) await saveList(KEY.STUDENTS, updated);
    }
    return true;
  }

  /* ═══════════ TIMETABLE ═══════════ */
  async function getTimetable() {
    await seedDefaults();
    return loadList(KEY.TIMETABLE);
  }

  /* ═══════════ PROFILE ═══════════ */
  async function getProfile(userId) {
    return (await getDoc('profiles', userId)) || {};
  }
  async function saveProfile(userId, data) {
    return setDoc('profiles', userId, data);
  }
  async function getAvatar(userId) {
    const doc = await getDoc('avatars', userId);
    return doc ? doc.data : null;
  }
  async function saveAvatar(userId, data) {
    return setDoc('avatars', userId, { data });
  }

  /* ═══════════ ADMIN ACCOUNT ═══════════ */
  async function getAdminUser() {
    const users = await getDoc('config', 'users') || {};
    return users['admin'] || null;
  }
  async function updateAdminProfile(data) {
    const users = await getDoc('config', 'users') || {};
    if (!users['admin']) return { ok: false, msg: 'Admin account not found.' };
    const allowed = ['name', 'email', 'phone', 'title'];
    allowed.forEach(k => { if (data[k] !== undefined) users['admin'][k] = data[k]; });
    await setDoc('config', 'users', users);
    await logActivity('Admin profile updated', '👤', 'info');
    return { ok: true, user: users['admin'] };
  }
  async function changeAdminPassword(currentPassword, newPassword) {
    const users = await getDoc('config', 'users') || {};
    const admin = users['admin'];
    if (!admin) return { ok: false, msg: 'Admin account not found.' };
    const hashedCurrent = await hashPassword(currentPassword);
    const currentMatch = admin.password === hashedCurrent;
    if (!currentMatch) return { ok: false, msg: 'Current password is incorrect.' };
    if (!newPassword || newPassword.length < 8) return { ok: false, msg: 'New password must be at least 8 characters.' };
    users['admin'].password = await hashPassword(newPassword);
    users['admin'].mustChangePassword = false;
    await setDoc('config', 'users', users);
    await logActivity('Admin password changed', '🔒', 'warning');
    return { ok: true };
  }

  /* ═══════════ ACTIVITY ═══════════ */
  async function getActivity() {
    await seedDefaults();
    return loadList(KEY.ACTIVITY);
  }
  async function logActivity(msg, icon, type) {
    const act = await getActivity();
    act.unshift({ msg, icon: icon || '📌', type: type || 'info', time: new Date().toISOString() });
    if (act.length > 50) act.pop();
    await saveList(KEY.ACTIVITY, act);
  }

  /* ═══════════ STATS ═══════════ */
  async function getStats() {
    const [students, teachers, plans, notes, payments] = await Promise.all([
      getStudents(), getTeachers(), getLessonPlans(), getLessonNotes(), getPayments()
    ]);
    const paid       = students.filter(s => s.fee === 'Paid').length;
    const partial    = students.filter(s => s.fee === 'Partial').length;
    const unpaid     = students.filter(s => s.fee === 'Unpaid').length;
    const totalCollected = students.reduce((sum, s) => sum + (s.feePaid || 0), 0);
    const totalDue       = students.reduce((sum, s) => sum + (s.feeDue  || 0), 0);
    return {
      totalStudents:   students.length,
      totalTeachers:   teachers.length,
      pendingPlans:    plans.filter(p => p.status === 'Pending').length,
      pendingNotes:    notes.filter(n => n.status === 'Pending').length,
      pendingPayments: payments.filter(p => p.status === 'Pending').length,
      feesPaid: paid, feesPartial: partial, feesUnpaid: unpaid,
      totalCollected, totalDue,
      collectionRate: totalDue > 0 ? Math.round((totalCollected / totalDue) * 100) : 0,
    };
  }

  /* ═══════════ PRESENCE ═══════════ */
  const PRESENCE_TTL = 60000;
  async function getPresence() {
    return (await getDoc('config', 'presence')) || {};
  }
  async function setPresence(role, id, username, name) {
    const p = await getPresence();
    p[id] = { role, id, username, name, lastSeen: Date.now() };
    await setDoc('config', 'presence', p);
  }
  async function clearPresence(id) {
    const p = await getPresence();
    delete p[id];
    await setDoc('config', 'presence', p);
  }
  async function getOnlineUsers() {
    const p = await getPresence();
    const cutoff = Date.now() - PRESENCE_TTL;
    const fresh = {};
    Object.values(p).forEach(u => { if (u.lastSeen >= cutoff) fresh[u.id] = u; });
    if (Object.keys(fresh).length !== Object.keys(p).length) {
      await setDoc('config', 'presence', fresh);
    }
    return Object.values(fresh).sort((a, b) => b.lastSeen - a.lastSeen);
  }

  /* ═══════════ ATTENDANCE ═══════════ */
  // Stored as a Firestore document per teacher in the 'attendance' collection.
  // Document ID = teacher username.
  // Shape: { [class_dateKey]: { [studentName]: 'P'|'A'|'L' }, updatedAt: ISO }
  // e.g. { "Primary 3_2025-05-01": { "Adeyemi Blessing": "P", ... } }
  async function getAttendance(teacherUsername) {
    const doc = await getDoc('attendance', teacherUsername);
    return doc ? doc : {};
  }
  async function saveAttendance(teacherUsername, allData) {
    // allData is the entire teacher attendance map
    await db.collection('attendance').doc(teacherUsername).set(
      { ...allData, updatedAt: new Date().toISOString() }
    );
    return true;
  }
  async function getAttendanceRecord(teacherUsername, cls, dateKey) {
    const doc = await getAttendance(teacherUsername);
    const fieldKey = cls.replace(/\s/g, '_') + '_' + dateKey;
    return doc[fieldKey] || {};
  }
  async function saveAttendanceRecord(teacherUsername, cls, dateKey, record) {
    const fieldKey = cls.replace(/\s/g, '_') + '_' + dateKey;
    await db.collection('attendance').doc(teacherUsername).set(
      { [fieldKey]: record, updatedAt: new Date().toISOString() },
      { merge: true }
    );
    return true;
  }

  /* ═══════════ SUBMISSION TRACKER ═══════════ */
  // Stored as a Firestore document per teacher in the 'submission_tracker' collection.
  // Document ID = teacher username.
  // Shape: { [contentId]: { [studentName]: 'submitted'|'viewed'|'pending' }, updatedAt: ISO }
  async function getSubmissionTracker(teacherUsername) {
    const doc = await getDoc('submission_tracker', teacherUsername);
    return doc ? doc : {};
  }
  async function saveSubmissionRecord(teacherUsername, contentId, record) {
    await db.collection('submission_tracker').doc(teacherUsername).set(
      { [String(contentId)]: record, updatedAt: new Date().toISOString() },
      { merge: true }
    );
    return true;
  }

  /* ═══════════ ONLINE EXAMS ═══════════ */
  // All teachers' exams are stored in 'online_exams' collection.
  // Each doc ID = teacher username; shape: { items: [...exams], updatedAt }
  // This allows any student to read all published exams across all teachers.

  async function getPublishedExams(studentClass) {
    try {
      const snap = await db.collection('online_exams').get();
      let all = [];
      snap.forEach(doc => {
        const items = doc.data().items || [];
        all = all.concat(items);
      });
      // Filter: active status, matching class (or 'All Classes')
      const now = new Date();
      return all.filter(e => {
        if (e.status !== 'active') return false;
        if (e.class && e.class !== 'All Classes' && e.class !== studentClass) return false;
        return true;
      }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    } catch (err) {
      console.error('getPublishedExams', err);
      return [];
    }
  }

  async function submitExamResult(examId, studentId, resultData) {
    try {
      await db.collection('exam_results').doc(`${examId}_${studentId}`).set({
        ...resultData,
        examId,
        studentId,
        submittedAt: new Date().toISOString(),
      });
      return true;
    } catch (err) {
      console.error('submitExamResult failed:', err.code, err.message, err);
      return false;
    }
  }

  async function getStudentExamResult(examId, studentId) {
    try {
      const snap = await db.collection('exam_results').doc(`${examId}_${studentId}`).get();
      return snap.exists ? snap.data() : null;
    } catch (err) {
      console.error('getStudentExamResult', err);
      return null;
    }
  }

  async function deleteExamResult(examId, studentId) {
    try {
      await db.collection('exam_results').doc(`${examId}_${studentId}`).delete();
      return true;
    } catch (err) {
      console.error('deleteExamResult', err);
      return false;
    }
  }

  // Save exams for a specific teacher into the shared collection
  async function saveTeacherExams(teacherUsername, exams) {
    try {
      await db.collection('online_exams').doc(teacherUsername).set({
        items: exams,
        updatedAt: new Date().toISOString(),
      });
      return true;
    } catch (err) {
      console.error('saveTeacherExams', err);
      return false;
    }
  }

  async function getTeacherExams(teacherUsername) {
    try {
      const snap = await db.collection('online_exams').doc(teacherUsername).get();
      return snap.exists ? (snap.data().items || []) : [];
    } catch (err) {
      console.error('getTeacherExams', err);
      return [];
    }
  }

  /* ═══════════ SAVE PAYMENTS (backup restore) ═══════════ */
  async function savePayments(arr) { return saveList(KEY.PAYMENTS, arr); }

  /* ═══════════ TIMETABLE (full save) ═══════════ */
  // Stores the timetable grid in config/admin_ui so admin can persist a custom layout.
  async function saveTimetableData(data) {
    try {
      await db.collection('config').doc('admin_ui').set(
        { timetable_v2: data, updatedAt: new Date().toISOString() },
        { merge: true }
      );
      return true;
    } catch(e) { console.error('saveTimetableData', e); return false; }
  }

  /* ═══════════ BULK SAVE HELPERS (used by backup restore) ═══════════ */
  async function saveLessonPlans(arr)   { return saveList(KEY.LESSON_PLANS,   arr); }
  async function saveLessonNotes(arr)   { return saveList(KEY.LESSON_NOTES,   arr); }
  async function saveAnnouncements(arr) { return saveList(KEY.ANNOUNCEMENTS,  arr); }
  async function saveActivity(arr)      { return saveList(KEY.ACTIVITY,       arr); }
  async function saveNotifications(arr) { return saveList(KEY.NOTIFICATIONS,  arr); }
  async function saveClassNotes(arr)    { return saveList(KEY.CLASS_NOTES,    arr); }

  /* ═══════════ TEACHER RESULT SUBMISSIONS ═══════════ */
  // Each doc ID is auto-generated; shape: { studentId, teacherUsername, results, submittedAt }
  async function getAllResultSubmissions() {
    try {
      const snap = await db.collection('teacher_result_submissions').orderBy('submittedAt', 'desc').get();
      const results = [];
      snap.forEach(doc => results.push({ _docId: doc.id, ...doc.data() }));
      return results;
    } catch(e) { console.error('getAllResultSubmissions', e); return []; }
  }
  async function restoreResultSubmissions(submissions) {
    try {
      const batch = db.batch();
      submissions.forEach(sub => {
        const { _docId, ...data } = sub;
        if (_docId) batch.set(db.collection('teacher_result_submissions').doc(_docId), data);
      });
      await batch.commit();
      return true;
    } catch(e) { console.error('restoreResultSubmissions', e); return false; }
  }

  /* ═══════════ TP EXAM RESULTS ═══════════ */
  // Keyed by teacher username; each doc contains that teacher's exam result records.
  async function getAllTpExamResults() {
    try {
      const snap = await db.collection('tp_exam_results').get();
      const map = {};
      snap.forEach(doc => { map[doc.id] = doc.data(); });
      return map;
    } catch(e) { console.error('getAllTpExamResults', e); return {}; }
  }
  async function restoreTpExamResults(map) {
    try {
      const batch = db.batch();
      Object.entries(map).forEach(([teacherUsername, data]) => {
        batch.set(db.collection('tp_exam_results').doc(teacherUsername), data);
      });
      await batch.commit();
      return true;
    } catch(e) { console.error('restoreTpExamResults', e); return false; }
  }

  /* ═══════════ DISTRIBUTED TIMETABLES ═══════════ */
  // Each doc ID = class name; shape is the teacher's distributed timetable for that class.
  async function getAllDistributedTimetables() {
    try {
      const snap = await db.collection('distributed_timetables').get();
      const map = {};
      snap.forEach(doc => { map[doc.id] = doc.data(); });
      return map;
    } catch(e) { console.error('getAllDistributedTimetables', e); return {}; }
  }
  async function restoreDistributedTimetables(map) {
    try {
      const batch = db.batch();
      Object.entries(map).forEach(([cls, data]) => {
        batch.set(db.collection('distributed_timetables').doc(cls), data);
      });
      await batch.commit();
      return true;
    } catch(e) { console.error('restoreDistributedTimetables', e); return false; }
  }

  /* ═══════════ ALL ATTENDANCE (admin view) ═══════════ */
  // Returns every teacher's attendance map keyed by teacher username.
  // Shape: { teacherUsername: { fieldKey: { studentName: 'P'|'A'|'L' } } }
  async function getAllAttendanceRecords() {
    try {
      const snap = await db.collection('attendance').get();
      const result = {};
      snap.forEach(doc => {
        const data = doc.data();
        const fields = {};
        Object.entries(data).forEach(([k, v]) => {
          if (k !== 'updatedAt' && typeof v === 'object') fields[k] = v;
        });
        result[doc.id] = fields;
      });
      return result;
    } catch(e) { console.error('getAllAttendanceRecords', e); return {}; }
  }

  /* ═══════════ ADMIN UI STATE ═══════════ */
  // Persists per-field admin UI preferences (dark mode, notification read count, etc.)
  // in config/admin_ui using merge writes so fields are independent.
  async function getAdminUIState(field, defaultValue) {
    try {
      const doc = await getDoc('config', 'admin_ui');
      if (!doc || doc[field] === undefined) return defaultValue !== undefined ? defaultValue : null;
      return doc[field];
    } catch(e) { return defaultValue !== undefined ? defaultValue : null; }
  }
  async function setAdminUIState(field, value) {
    try {
      await db.collection('config').doc('admin_ui').set(
        { [field]: value, updatedAt: new Date().toISOString() },
        { merge: true }
      );
      return true;
    } catch(e) { console.error('setAdminUIState', e); return false; }
  }

  /* ═══════════ STUDENT UI STATE ═══════════ */
  // Persists per-field student UI preferences (notification read list, etc.)
  // in student_ui/<studentId> using merge writes.
  async function getStudentUIState(studentId, field, defaultValue) {
    if (!studentId) return defaultValue !== undefined ? defaultValue : null;
    try {
      const doc = await getDoc('student_ui', studentId);
      if (!doc || doc[field] === undefined) return defaultValue !== undefined ? defaultValue : null;
      return doc[field];
    } catch(e) { return defaultValue !== undefined ? defaultValue : null; }
  }
  async function setStudentUIState(studentId, field, value) {
    if (!studentId) return false;
    try {
      await db.collection('student_ui').doc(studentId).set(
        { [field]: value, updatedAt: new Date().toISOString() },
        { merge: true }
      );
      return true;
    } catch(e) { console.error('setStudentUIState', e); return false; }
  }

  /* ═══════════ ALL ONLINE EXAMS (admin view) ═══════════ */
  // Reads all teachers' exams from the shared online_exams collection.
  async function getAllOnlineExams() {
    try {
      const snap = await db.collection('online_exams').get();
      let all = [];
      snap.forEach(doc => { all = all.concat(doc.data().items || []); });
      return all.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    } catch(e) { console.error('getAllOnlineExams', e); return []; }
  }

  /* ═══════════ ALL EXAM RESULTS (admin view) ═══════════ */
  // Reads all student exam submissions from the shared exam_results collection.
  async function getAllExamResults() {
    try {
      const snap = await db.collection('exam_results').get();
      const results = [];
      snap.forEach(doc => results.push({ _docId: doc.id, ...doc.data() }));
      return results;
    } catch(e) { console.error('getAllExamResults', e); return []; }
  }

  /* ═══════════ CHESS — ONLINE STUDENT VS STUDENT ═══════════
   * Collection: chess_matches. One doc per challenge/game.
   * Shape (grows as the challenge is accepted / played):
   *   {
   *     id, status: 'pending' | 'active' | 'finished' | 'declined' | 'cancelled',
   *     challengerId, challengerUsername, challengerName,   // set on creation
   *     opponentUsername,                                   // lowercase, set on creation
   *     whiteId, whiteUsername, whiteName,                  // set on accept
   *     blackId, blackUsername, blackName,                  // set on accept
   *     board, turn, castling, epTarget,
   *     capturedByWhite, capturedByBlack, moveLog, lastMove, gameOver,
   *     createdAt, updatedAt
   *   }
   * Board/move logic all lives in the chess widget itself (it's a sandboxed
   * iframe) — this layer just stores/streams whatever state it's given.
   */
  async function createChessChallenge(payload) {
    try {
      const ref = db.collection('chess_matches').doc();
      await ref.set({
        id: ref.id,
        status: 'pending',
        challengerId: payload.challengerId,
        challengerUsername: payload.challengerUsername,
        challengerName: payload.challengerName,
        opponentUsername: (payload.opponentUsername || '').toLowerCase(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      return { ok: true, matchId: ref.id };
    } catch(e) {
      console.error('createChessChallenge', e);
      return { ok: false, msg: e.message || 'Could not create challenge.' };
    }
  }

  async function acceptChessChallenge(matchId, fields) {
    try {
      await db.collection('chess_matches').doc(matchId).update({
        ...fields,
        updatedAt: new Date().toISOString(),
      });
      return true;
    } catch(e) { console.error('acceptChessChallenge', e); return false; }
  }

  async function declineChessChallenge(matchId) {
    try {
      await db.collection('chess_matches').doc(matchId).update({
        status: 'declined', updatedAt: new Date().toISOString(),
      });
      return true;
    } catch(e) { console.error('declineChessChallenge', e); return false; }
  }

  async function cancelChessChallenge(matchId) {
    try {
      await db.collection('chess_matches').doc(matchId).update({
        status: 'cancelled', updatedAt: new Date().toISOString(),
      });
      return true;
    } catch(e) { console.error('cancelChessChallenge', e); return false; }
  }

  async function updateChessMatch(matchId, fields) {
    try {
      await db.collection('chess_matches').doc(matchId).update({
        ...fields,
        updatedAt: new Date().toISOString(),
      });
      return true;
    } catch(e) { console.error('updateChessMatch', e); return false; }
  }

  // Live-updates a single match. Returns an unsubscribe function.
  function subscribeChessMatch(matchId, callback) {
    return db.collection('chess_matches').doc(matchId).onSnapshot(
      (snap) => callback(snap.exists ? snap.data() : null),
      (err) => { console.error('subscribeChessMatch', err); callback(null); }
    );
  }

  // Live-updates ALL pending challenges (client filters to the ones addressed
  // to them). Kept as a single equality filter + limit to avoid needing any
  // composite Firestore indexes. Returns an unsubscribe function.
  function subscribePendingChessChallenges(callback) {
    return db.collection('chess_matches').where('status', '==', 'pending').limit(200).onSnapshot(
      (snap) => { const arr = []; snap.forEach(d => arr.push(d.data())); callback(arr); },
      (err) => { console.error('subscribePendingChessChallenges', err); callback([]); }
    );
  }

  // Live-updates ALL active matches (client filters to the ones the current
  // student is playing in). Returns an unsubscribe function.
  function subscribeActiveChessMatches(callback) {
    return db.collection('chess_matches').where('status', '==', 'active').limit(200).onSnapshot(
      (snap) => { const arr = []; snap.forEach(d => arr.push(d.data())); callback(arr); },
      (err) => { console.error('subscribeActiveChessMatches', err); callback([]); }
    );
  }

  /* ═══════════ NEW SESSION — ARCHIVE / ERASE ═══════════ */
  // Deletes every document in a Firestore collection (batched, 400 at a time).
  async function _deleteCollection(name) {
    try {
      const snap = await db.collection(name).get();
      if (snap.empty) return;
      const docs = snap.docs;
      const commits = [];
      for (let i = 0; i < docs.length; i += 400) {
        const batch = db.batch();
        docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
        commits.push(batch.commit());
      }
      await Promise.all(commits);
    } catch (e) { console.error('_deleteCollection(' + name + ')', e); }
  }

  // Wipes last session's academic/financial data so admin, teacher, and student
  // portals all start the new session clean (they all read from this same
  // Firestore backend, so nothing extra is needed on the portal side).
  // Students, teachers, login accounts, school settings, and fee configuration
  // are NEVER touched by this function — only the flags passed in `opts`
  // control what gets cleared. Everything defaults to true (full reset).
  async function eraseSessionData(opts = {}) {
    const {
      results       = true,
      payments      = true,
      attendance    = true,
      lessonPlans   = true,
      lessonNotes   = true,
      classNotes    = true,
      assignments   = true,
      announcements = true,
      exams         = true,
      notifications = true,
      activityLog   = true,
      resetFeeBalances = false,
    } = opts;

    const tasks = [];
    if (results) {
      tasks.push(_deleteCollection('results'));           // per-student results docs
      tasks.push(setDoc('config', 'results', {}));        // legacy shared map
    }
    if (payments) {
      tasks.push(saveList(KEY.PAYMENTS, []));
      tasks.push(_deleteCollection('proofs'));             // payment screenshot proofs
    }
    if (attendance) {
      tasks.push(_deleteCollection('attendance'));
      tasks.push(_deleteCollection('submission_tracker'));
    }
    if (lessonPlans)   tasks.push(saveList(KEY.LESSON_PLANS, []));
    if (lessonNotes)   tasks.push(saveList(KEY.LESSON_NOTES, []));
    if (classNotes)    tasks.push(saveList(KEY.CLASS_NOTES, []));
    if (assignments)   tasks.push(saveList(KEY.ASSIGNMENTS, []));
    if (announcements) tasks.push(saveList(KEY.ANNOUNCEMENTS, []));
    if (exams) {
      tasks.push(_deleteCollection('online_exams'));
      tasks.push(_deleteCollection('exam_results'));
      tasks.push(_deleteCollection('teacher_result_submissions'));
      tasks.push(_deleteCollection('tp_exam_results'));
      tasks.push(_deleteCollection('distributed_timetables'));
    }
    if (notifications) tasks.push(saveList(KEY.NOTIFICATIONS, []));

    await Promise.all(tasks);

    if (resetFeeBalances) {
      const students = await getStudents();
      students.forEach(s => { s.feePaid = 0; s.fee = 'Unpaid'; });
      await saveStudents(students);
    }

    if (activityLog) await saveList(KEY.ACTIVITY, []);
    await logActivity('New academic session started — previous session data was reset', '🎓', 'success');

    return true;
  }

  /* ═══════════ INIT ═══════════ */
  seedDefaults(); // fire-and-forget on load — subsequent calls share the in-flight promise

  /* ═══════════ PUBLIC API ═══════════ */
  return {
    login, getAdminUser, updateAdminProfile, changeAdminPassword,
    getStats, getSettings, saveSettings, getTimetable, saveTimetableData,
    getStudents, saveStudents, addStudent, updateStudent, removeStudent,
    getTeachers, saveTeachers, addTeacher, updateTeacher, removeTeacher,
    getLessonPlans, addLessonPlan, updatePlanStatus, saveLessonPlans, deleteLessonPlan, undoPlanStatus,
    getLessonNotes, addLessonNote, updateNoteStatus, saveLessonNotes, deleteLessonNote, undoNoteStatus,
    getDomainApprovals, submitDomainApproval, updateDomainApprovalStatus, deleteDomainApproval, undoDomainApprovalStatus,
    getClassNotes, addClassNote, saveClassNotes,
    getAssignments, saveAssignments, addAssignment, removeAssignment, removeClassNote, cleanupExpiredContent,
    getNotifications, addNotification, getStudentNotifications, removeNotificationByRef, saveNotifications,
    getPayments, addPayment, savePayments, confirmPayment, rejectPayment, getPaymentProof, deletePaymentProof,
    getAnnouncements, addAnnouncement, removeAnnouncement, toggleAnnouncementPin, saveAnnouncements,
    getResults, saveResult, getAllResults, saveAllResults,
    getWithheldResults, isResultWithheld, setWithheldResult, releaseWithheldResult,
    getProfile, saveProfile, getAvatar, saveAvatar,
    getActivity, logActivity, saveActivity,
    setPresence, clearPresence, getOnlineUsers,
    getAttendance, saveAttendance, getAttendanceRecord, saveAttendanceRecord, getAllAttendanceRecords,
    getSubmissionTracker, saveSubmissionRecord,
    getPublishedExams, submitExamResult, getStudentExamResult, deleteExamResult,
    saveTeacherExams, getTeacherExams, getAllOnlineExams, getAllExamResults,
    getAllResultSubmissions, restoreResultSubmissions,
    getAllTpExamResults, restoreTpExamResults,
    getAllDistributedTimetables, restoreDistributedTimetables,
    getAdminUIState, setAdminUIState,
    getStudentUIState, setStudentUIState,
    createChessChallenge, acceptChessChallenge, declineChessChallenge, cancelChessChallenge,
    updateChessMatch, subscribeChessMatch, subscribePendingChessChallenges, subscribeActiveChessMatches,
    eraseSessionData,
    KEY,
  };
})();