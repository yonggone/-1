'use strict';
(() => {
  const page = document.getElementById('account-page');
  const calendar = document.getElementById('calendar-page');
  const nav = document.getElementById('profile-nav');
  let me = null;
  let viewVersion = 0;

  async function api(path, data) {
    const response = await fetch('/api/' + path, data === undefined ? { cache: 'no-store' } : {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Class-Board': '1' }, body: JSON.stringify(data)
    });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 401 && path !== 'login') { me = null; loginView(); }
      throw new Error(result.error || '다시 시도해 주세요.');
    }
    return result;
  }

  function avatarUrl(id, stamp = '') {
    return '/api/avatars/' + encodeURIComponent(id) + (stamp ? ('?v=' + stamp) : '');
  }

  function setAvatar(container, profile, stamp = '') {
    container.replaceChildren();
    const img = document.createElement('img');
    img.alt = '프로필 사진';
    img.src = avatarUrl(profile.id, stamp);
    img.className = 'avatar-image';
    const fallback = document.createElement('span');
    fallback.textContent = profile.role === 'teacher' ? '쌤' : profile.id.slice(-2);
    fallback.className = 'avatar-fallback';
    img.onerror = () => {
      container.replaceChildren(fallback);
    };
    container.append(img);
  }

  function accountView(html) {
    document.querySelector('.friend-profile-dialog')?.close();
    viewVersion++;
    document.getElementById('home-page').hidden = true;
    document.getElementById('boards-page').hidden = true;
    document.dispatchEvent(new CustomEvent('classboard:view', { detail: { kind: 'account', user: me } }));
    calendar.hidden = true;
    page.hidden = false;
    nav.hidden = !me || Boolean(me.must_change);
    page.innerHTML = `<div class="account-shell">${html}</div>`;
    window.scrollTo(0, 0);
  }

  function message(text) {
    const target = document.getElementById('form-message');
    if (target) target.textContent = text;
  }

  function submit(form, task) {
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const button = form.querySelector('[type="submit"]');
      button.disabled = true;
      message('');
      try { await task(new FormData(form)); }
      catch (error) { message(error.message || '연결을 확인하고 다시 시도해 주세요.'); }
      finally { button.disabled = false; }
    });
  }

  async function readImageAsBase64(file) {
    if (!file) return null;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) {
      throw new Error('10MB 이하의 JPG, PNG, WebP 사진을 골라 주세요.');
    }
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('사진을 읽지 못했어요. 다시 골라 주세요.'));
      reader.readAsDataURL(file);
    });
    return dataUrl.split(',')[1];
  }

  function loginView() {
    accountView(`<p class="account-kicker">WELCOME TO OUR CLASS</p><h1>반가워요,<br>2-4반 친구들</h1><p class="account-lead">우리 반 게시판에 오신 것을 환영해요.<br>내 아이디로 로그인해 주세요.</p><form id="login-form" class="account-card"><label for="login-id">학번 또는 선생님 아이디</label><input id="login-id" name="id" autocomplete="username" placeholder="학번을 입력해 주세요" required maxlength="30"><label for="login-password">비밀번호</label><input id="login-password" name="password" type="password" autocomplete="current-password" placeholder="비밀번호를 입력해 주세요" required maxlength="128"><button class="primary-button" type="submit">로그인하기</button><p id="form-message" class="form-message" role="alert"></p></form><p class="form-hint">처음 로그인하는 학생의 비밀번호는 1234예요.<br>로그인 후 나만의 비밀번호로 바꿔 주세요.</p>`);
    submit(document.getElementById('login-form'), async form => {
      const result = await api('login', Object.fromEntries(form));
      me = result.user;
      if (me.must_change) passwordView(true);
      else if (!me.name) profileView(true);
      else showHome();
    });
  }

  function passwordView(first) {
    accountView(`<p class="account-kicker">${first ? 'FIRST HELLO' : 'MY ACCOUNT'}</p><h1>${first ? '나만의 비밀번호를<br>정해 주세요 🔐' : '비밀번호 바꾸기 🔐'}</h1><p class="account-lead">${first ? '처음 로그인했으니 비밀번호를 먼저 바꿔요.<br>변경 후 프로필 설정 화면이 열려요.' : '다른 친구들이 모르는 비밀번호로 정해 주세요.'}</p><form id="password-form" class="account-card"><input name="username" autocomplete="username" hidden>${first ? '' : '<label for="current-password">현재 비밀번호</label><input id="current-password" name="current" type="password" autocomplete="current-password" maxlength="128" required>'}<label for="new-password">새 비밀번호</label><input id="new-password" name="password" type="password" autocomplete="new-password" minlength="8" maxlength="128" placeholder="8자 이상 입력해 주세요" required><label for="confirm-password">새 비밀번호 확인</label><input id="confirm-password" name="confirm" type="password" autocomplete="new-password" minlength="8" maxlength="128" placeholder="한 번 더 입력해 주세요" required><button class="primary-button" type="submit">비밀번호 저장하기</button><p id="form-message" class="form-message" role="alert"></p></form><div class="profile-actions"><button id="password-back" class="text-button">${first ? '다른 계정으로 로그인' : '프로필로 돌아가기'}</button></div>`);
    document.querySelector('[name="username"]').value = me.id;
    document.getElementById('password-back').onclick = first ? logout : () => profileView(false);
    submit(document.getElementById('password-form'), async form => {
      if (form.get('password') !== form.get('confirm')) throw new Error('새 비밀번호가 서로 달라요. 다시 확인해 주세요.');
      const result = await api('password', { password: form.get('password'), current: form.get('current') });
      me = result.user;
      if (first) profileView(true);
      else { profileView(false); message('비밀번호를 바꿨어요'); }
    });
  }

  function showCalendar() {
    document.getElementById('home-page').hidden = true;
    viewVersion++;
    page.hidden = true;
    calendar.hidden = false;
    nav.hidden = false;
    document.getElementById('boards-page').hidden = true;
    document.dispatchEvent(new CustomEvent('classboard:view', { detail: { kind: 'calendar', user: me } }));
    window.scrollTo(0, 0);
  }

  function showBoard(kind) {
    if (!me) return loginView();
    if (me.must_change) return passwordView(true);
    if (!me.name) return profileView(true);
    viewVersion++;
    page.hidden = true;
    calendar.hidden = true;
    nav.hidden = false;
    document.getElementById('home-page').hidden = true;
    document.getElementById('boards-page').hidden = false;
    document.dispatchEvent(new CustomEvent('classboard:view', { detail: { kind, user: me } }));
    window.scrollTo(0, 0);
  }

  function showHome() {
    if (!me) return loginView();
    if (me.must_change) return passwordView(true);
    if (!me.name) return profileView(true);
    viewVersion++;
    page.hidden = true;
    calendar.hidden = true;
    nav.hidden = false;
    document.getElementById('boards-page').hidden = true;
    document.getElementById('home-page').hidden = false;
    document.dispatchEvent(new CustomEvent('classboard:view', { detail: { kind: 'home', user: me } }));
    window.scrollTo(0, 0);
  }

  function profileView(firstSetup = false) {
    if (!me) return loginView();
    if (me.must_change) return passwordView(true);
    if (firstSetup || !me.name) return profileEditView(true);
    accountView(`<div class="profile-top profile-summary-top"><h1>내 프로필</h1><button id="calendar-back" type="button" class="text-button">학사일정으로 ↗</button></div><div class="profile-id"><span class="avatar" id="my-avatar"></span><div><strong id="my-id"></strong><small id="my-role"></small></div></div><dl class="my-profile-info"><dt>이름</dt><dd id="my-name"></dd><dt>생일</dt><dd id="my-birthday"></dd><dt>인스타그램</dt><dd id="my-instagram"></dd></dl><button id="edit-profile" type="button" class="primary-button">프로필 수정하기</button><p id="form-message" class="form-message" role="status"></p><div class="profile-actions"><button id="change-password" type="button" class="password-change-button">비밀번호 변경하기</button><button id="logout" type="button" class="text-button">로그아웃</button></div><section class="friends-section"><h2>우리 반 친구들</h2><p>프로필을 누르면 자세히 볼 수 있어요.</p><div id="friends" class="friends-grid" aria-live="polite">프로필을 불러오고 있어요…</div></section>`);
    document.getElementById('my-id').textContent = me.name;
    document.getElementById('my-role').textContent = me.id + (me.role === 'teacher' ? ' · 우리 반 선생님' : ' · 2학년 4반');
    setAvatar(document.getElementById('my-avatar'), me, Date.now().toString());
    document.getElementById('my-name').textContent = me.name;
    document.getElementById('my-birthday').textContent = me.birthday ? `${Number(me.birthday.slice(0, 2))}월 ${Number(me.birthday.slice(3))}일` : '미설정';
    const instagram = document.getElementById('my-instagram');
    if (me.instagram) {
      const link = document.createElement('a');
      link.textContent = '@' + me.instagram;
      link.href = 'https://www.instagram.com/' + encodeURIComponent(me.instagram) + '/';
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      instagram.append(link);
    } else instagram.textContent = '미설정';
    document.getElementById('edit-profile').onclick = () => profileEditView(false);
    document.getElementById('calendar-back').onclick = showCalendar;
    document.getElementById('change-password').onclick = () => passwordView(false);
    document.getElementById('logout').onclick = logout;
    loadFriends();
  }

  function profileEditView(firstSetup = false) {
    if (!me) return loginView();
    if (me.must_change) return passwordView(true);
    accountView(`<div class="profile-top"><h1>${firstSetup ? '프로필 설정' : '프로필 수정'}</h1><button id="calendar-back" class="text-button" ${firstSetup ? 'hidden' : ''}>프로필로 돌아가기</button></div><div class="profile-id"><span class="avatar" id="my-avatar"></span><div><strong id="my-id"></strong><small id="my-role"></small></div></div><p class="account-lead">${firstSetup ? '비밀번호 변경이 끝났어요! 이제 프로필을 설정해 주세요.' : '내 생일과 인스타를 친구들에게 알려 주세요.<br>입력한 정보는 로그인한 우리 반 친구들이 볼 수 있어요.'}</p><form id="profile-form" class="account-card"><label for="profile-name">이름 (필수)</label><input id="profile-name" name="name" maxlength="20" autocomplete="name" placeholder="친구들에게 보여줄 이름" required><label for="birth-month">생일 (선택)</label><div class="birthday-fields"><select id="birth-month" name="month" aria-label="태어난 월"><option value="">월 선택</option></select><select id="birth-day" name="day" aria-label="태어난 일"><option value="">일 선택</option></select></div><label for="instagram">인스타그램 아이디 (선택)</label><input id="instagram" name="instagram" autocomplete="off" placeholder="@ 없이 아이디만 입력" maxlength="31" spellcheck="false"><label for="profile-photo">프로필 사진 (선택)</label><input id="profile-photo" type="file" accept="image/jpeg,image/png,image/webp"><figure id="profile-photo-preview" class="polaroid photo-preview" hidden><img id="profile-photo-preview-image" alt="프로필 사진 미리보기"><figcaption>프로필 사진 미리보기</figcaption></figure><label class="inline-checkbox"><input type="checkbox" id="remove-avatar">기본 프로필로 변경하기</label><p class="field-note">이름은 필수예요. 생일·인스타·프로필 사진은 비워도 돼요.</p><button class="primary-button" type="submit">프로필 저장하기</button><p id="form-message" class="form-message" role="status"></p></form><p class="form-hint">프로필 설정은 나중에 다시 할 수 있어요.</p><div class="profile-actions"><button id="change-password" type="button" class="password-change-button" ${firstSetup ? 'hidden' : ''}>비밀번호 변경하기</button><button id="logout" class="text-button">로그아웃</button></div>`);

    document.getElementById('my-id').textContent = me.name || me.id;
    document.getElementById('my-role').textContent = me.role === 'teacher' ? '강경민 · 우리 반 선생님' : me.id + ' · 2학년 4반 ' + Number(me.id.slice(-2)) + '번';
    setAvatar(document.getElementById('my-avatar'), me, Date.now().toString());

    const month = document.getElementById('birth-month');
    const day = document.getElementById('birth-day');
    for (let i = 1; i <= 12; i++) month.add(new Option(`${i}월`, String(i).padStart(2, '0')));
    function updateDays(value = '') {
      day.replaceChildren(new Option('일 선택', ''));
      const count = month.value ? new Date(2000, Number(month.value), 0).getDate() : 31;
      for (let i = 1; i <= count; i++) day.add(new Option(`${i}일`, String(i).padStart(2, '0')));
      day.value = Number(value) <= count ? value : '';
    }

    month.value = me.birthday.slice(0, 2);
    updateDays(me.birthday.slice(3));
    month.onchange = () => updateDays(day.value);
    document.getElementById('profile-name').value = me.name || '';
    document.getElementById('instagram').value = me.instagram;

    const photoInput = document.getElementById('profile-photo');
    const preview = document.getElementById('profile-photo-preview');
    let avatarData = null;
    let selected = null;
    photoInput.onchange = async event => {
      const file = event.target.files[0];
      selected = file;
      avatarData = null;
      preview.hidden = true;
      message('');
      if (!file) return;
      try {
        avatarData = await readImageAsBase64(file);
        if (selected !== file) return;
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error('미리보기를 만들지 못했어요.'));
          reader.readAsDataURL(file);
        });
        document.getElementById('profile-photo-preview-image').src = dataUrl;
        preview.hidden = false;
      } catch (error) {
        message(error.message);
        photoInput.value = '';
      }
    };

    const back = document.getElementById('calendar-back');
    if (back) back.onclick = () => profileView(false);
    const pw = document.getElementById('change-password');
    if (pw) pw.onclick = () => passwordView(false);
    document.getElementById('logout').onclick = logout;

    submit(document.getElementById('profile-form'), async form => {
      if (Boolean(form.get('month')) !== Boolean(form.get('day'))) throw new Error('생일의 월과 일을 모두 골라 주세요.');
      const payload = {
        name: form.get('name'),
        birthday: form.get('month') ? `${form.get('month')}-${form.get('day')}` : '',
        instagram: form.get('instagram')
      };
      if (avatarData) payload.avatar = avatarData;
      if (document.getElementById('remove-avatar').checked) payload.remove_avatar = true;
      const result = await api('profile', payload);
      me = result.user;
      document.getElementById('my-id').textContent = me.name || me.id;
      setAvatar(document.getElementById('my-avatar'), me, Date.now().toString());
      if (firstSetup) showHome();
      else {
        profileView(false);
        message('프로필을 저장했어요');
      }
    });

  }

  function openFriendProfile(profile) {
    document.querySelector('.friend-profile-dialog')?.close();
    const dialog = document.createElement('dialog');
    dialog.className = 'friend-profile-dialog';
    dialog.setAttribute('aria-labelledby', 'friend-profile-title');
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'text-button friend-profile-close';
    close.textContent = '닫기 ×';
    close.onclick = () => dialog.close();
    const avatar = document.createElement('span');
    avatar.className = 'avatar friend-profile-avatar';
    setAvatar(avatar, profile, Date.now().toString());
    const title = document.createElement('h2');
    title.id = 'friend-profile-title';
    title.textContent = profile.name || '이름 미설정';
    const account = document.createElement('p');
    account.className = 'friend-profile-account';
    account.textContent = profile.id + (profile.role === 'teacher' ? ' · 선생님' : ' · 2학년 4반');
    const info = document.createElement('dl');
    info.className = 'friend-profile-info';
    function field(label, content) {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      if (typeof content === 'string') dd.textContent = content;
      else dd.append(content);
      info.append(dt, dd);
    }
    field('이름', profile.name || '미설정');
    const displayedName = info.lastElementChild;
    field('생일', profile.birthday ? `${Number(profile.birthday.slice(0, 2))}월 ${Number(profile.birthday.slice(3))}일` : '미설정');
    if (profile.instagram) {
      const link = document.createElement('a');
      link.textContent = '@' + profile.instagram;
      link.href = 'https://www.instagram.com/' + encodeURIComponent(profile.instagram) + '/';
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      field('인스타그램', link);
    } else field('인스타그램', '미설정');
    dialog.append(close, avatar, title, account, info);
    if (profile.id === me.id) {
      const own = document.createElement('button');
      own.type = 'button';
      own.className = 'password-change-button';
      own.textContent = '내 프로필 수정하기';
      own.onclick = () => { dialog.close(); profileEditView(false); };
      dialog.append(own);
    } else if (['20410', '20431'].includes(me.id)) {
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'password-change-button';
      edit.textContent = '이름 수정';
      const form = document.createElement('form');
      form.hidden = true;
      form.className = 'friend-name-form';
      const label = document.createElement('label');
      label.htmlFor = 'friend-new-name';
      label.textContent = '새 이름';
      const input = document.createElement('input');
      input.id = 'friend-new-name';
      input.type = 'text';
      input.value = profile.name || '';
      input.maxLength = 20;
      input.required = true;
      const save = document.createElement('button');
      save.type = 'submit';
      save.className = 'password-change-button';
      save.textContent = '저장';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'text-button';
      cancel.textContent = '취소';
      const status = document.createElement('p');
      status.setAttribute('role', 'status');
      form.append(label, input, save, cancel, status);
      edit.onclick = () => { form.hidden = false; edit.hidden = true; input.focus(); };
      cancel.onclick = () => { form.hidden = true; edit.hidden = false; input.value = profile.name || ''; status.textContent = ''; edit.focus(); };
      form.onsubmit = async event => {
        event.preventDefault();
        save.disabled = true;
        cancel.disabled = true;
        try {
          const result = await api('profile-name', { id: profile.id, name: input.value });
          profile.name = result.name;
          title.textContent = result.name;
          displayedName.textContent = result.name;
          if (dialog.isConnected && dialog.open) {
            form.hidden = true;
            edit.hidden = false;
            edit.focus();
          }
          if (!page.hidden && document.getElementById('friends')) await loadFriends();
        } catch (error) { status.textContent = error.message; }
        finally { save.disabled = false; cancel.disabled = false; }
      };
      dialog.append(edit, form);
    }
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const box = dialog.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
    });
    dialog.addEventListener('close', () => {
      dialog.remove();
      const trigger = [...document.querySelectorAll('[data-profile-id]')].find(b => b.dataset.profileId === profile.id);
      trigger?.focus();
    });
    document.body.append(dialog);
    dialog.showModal();
    close.focus();
  }

  async function loadFriends() {
    const version = viewVersion;
    try {
      const result = await api('profiles');
      if (version !== viewVersion) return;
      const container = document.getElementById('friends');
      if (!container) return;
      container.replaceChildren();
      result.profiles.forEach(profile => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'friend-card friend-profile-trigger';
        card.dataset.profileId = profile.id;
        card.setAttribute('aria-label', (profile.name ? profile.name + ' · ' : '') + profile.id + ' 프로필 크게 보기');
        card.setAttribute('aria-haspopup', 'dialog');
        card.onclick = () => openFriendProfile(profile);
        const avatar = document.createElement('span');
        avatar.className = 'avatar';
        setAvatar(avatar, profile);
        const name = document.createElement('strong');
        name.className = 'friend-tile-name';
        name.textContent = profile.name || profile.id;
        name.title = profile.name || profile.id;
        card.append(avatar, name);
        container.append(card);
      });
    } catch (error) {
      if (version === viewVersion) {
        const container = document.getElementById('friends');
        if (container) container.textContent = error.message;
      }
    }
  }

  async function logout() {
    try { await api('logout', {}); me = null; loginView(); }
    catch (error) { message(error.message); }
  }

  nav.onclick = () => profileView(false);
  window.classBoard = { api, getUser: () => me, showCalendar, showBoard, showHome };

  if (location.protocol === 'file:') {
    accountView('<h1>게시판을 켜 주세요</h1><p class="account-lead">로그인과 프로필을 저장하려면 서버가 필요해요.<br>이 폴더의 <b>게시판 시작.sh</b>를 실행한 뒤<br><a href="http://localhost:8080">http://localhost:8080</a>으로 접속해 주세요.</p>');
  } else {
    api('me').then(result => {
      me = result.user;
      if (!me) loginView();
      else if (me.must_change) passwordView(true);
      else if (!me.name) profileView(true);
      else showHome();
    }).catch(() => {
      accountView('<h1>연결을 확인해 주세요</h1><p class="account-lead">게시판 서버에 연결할 수 없어요.<br>게시판 시작.sh를 실행하고 새로고침해 주세요.</p>');
    });
  }
})();
