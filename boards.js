'use strict';
(() => {
  const page = document.getElementById('boards-page');
  const navigation = document.getElementById('board-navigation');
  const app = window.classBoard;
  let current = 'calendar', revision = 0;
  let seatEditMode = false;
  let seatEditorId = '';
  let seatProfiles = {};
  let fullSeatDraft = null;
  let selectedSeatStudent = '';
  let seatSaving = false;

  let notificationUser = null;
  let notificationRequest = 0;
  function paintNotifications(unread = {}) {
    navigation.querySelectorAll('[data-board]').forEach(button => {
      const kind = button.dataset.board;
      let badge = button.querySelector('.new-badge');
      if (unread[kind]) {
        if (!badge) {
          badge = el('span', 'new-badge', 'NEW');
          button.append(badge);
        }
        badge.setAttribute('aria-label', '새 글 또는 변경사항 있음');
      } else badge?.remove();
    });
  }
  async function refreshNotifications() {
    const user = app.getUser();
    if (!user || user.must_change || document.hidden) return;
    const request = ++notificationRequest;
    try {
      const data = await app.api('notifications');
      if (request === notificationRequest && app.getUser()?.id === user.id) paintNotifications(data.unread);
    } catch (_) { /* Keep unread state until the next successful refresh. */ }
  }
  async function acknowledge(kind, snapshot) {
    const user = app.getUser();
    if (!user || document.hidden) return;
    const request = ++notificationRequest;
    try {
      const data = await app.api('notifications/read', { kind, revision: snapshot });
      if (request === notificationRequest && app.getUser()?.id === user.id) paintNotifications(data.unread);
    } catch (_) { /* Failed reads remain unread. */ }
  }
  setInterval(refreshNotifications, 15000);
  window.addEventListener('focus', refreshNotifications);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshNotifications(); });

  const SEAT_EDITORS = ['20410', '20431', '20434'];
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const dateText = value => new Date(value).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
  const authorText = (id, name) => name ? `${name} · ${id}` : id === '강경민' ? '강경민 선생님' : id;
  const profileNameText = profile => profile?.name ? `${profile.name}` : (profile?.id || '미지정');

  const boardConfig = {
    assignments: {
      title: '수행평가 게시판',
      eyebrow: 'ONE STEP AT A TIME',
      description: '제목부터 준비할 내용까지, 함께 확인해 보세요 📝',
      button: '+ 글쓰기',
      writeTitle: '수행평가 작성하기 📝',
      writeLead: '준비할 내용을 친구들에게 알려 주세요.',
      backLabel: '수행평가',
      empty: '아직 작성된 수행평가가 없어요.',
      successCreate: '수행평가를 등록했어요 📝',
      successEdit: '수행평가를 수정했어요 📝'
    },
    notices: {
      title: '공지사항',
      eyebrow: 'IMPORTANT UPDATES',
      description: '꼭 확인해야 할 소식을 모아 두었어요 📌',
      button: '+ 글쓰기',
      writeTitle: '공지사항 작성하기 📌',
      writeLead: '친구들에게 전달할 중요한 내용을 적어 주세요.',
      backLabel: '공지사항',
      empty: '아직 등록된 공지사항이 없어요.',
      successCreate: '공지사항을 등록했어요 📌',
      successEdit: '공지사항을 수정했어요 📌'
    }
  };

  document.addEventListener('classboard:view', event => {
    const { kind, user } = event.detail;
    revision++;
    current = kind;
    if (notificationUser !== user?.id || !user || user.must_change) {
      notificationUser = user?.id;
      notificationRequest++;
      paintNotifications();
    }
    refreshNotifications();
    navigation.hidden = !user || Boolean(user.must_change);
    navigation.querySelectorAll('button').forEach(button => {
      if (button.dataset.board === kind) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    if (kind === 'resources') renderResources();
    else if (kind === 'class24') renderClass24();
    else if (kind === 'assignments' || kind === 'photos' || kind === 'notices') renderBoard(kind);
  });

  function navigate(kind) {
    if (kind === 'home') app.showHome();
    else if (kind === 'calendar') app.showCalendar();
    else app.showBoard(kind);
  }

  navigation.querySelectorAll('button').forEach(button => button.onclick = () => navigate(button.dataset.board));
  document.querySelectorAll('[data-home-board]').forEach(button => button.onclick = () => navigate(button.dataset.homeBoard));

  function renderResources() {
    page.innerHTML = `<div class="eyebrow"><span></span>FIND YOUR NEXT IDEA</div>
      <section class="board-hero"><div><h1>탐구 자료 찾기</h1><p>논문과 책에서 수행평가에 필요한 자료를 찾아보세요.</p></div></section>
      <div class="resource-grid">
        <section class="resource-card"><a class="resource-link" href="https://www.dbpia.co.kr/" target="_blank" rel="noopener noreferrer"><svg viewBox="0 0 100 110" fill="none" aria-hidden="true"><path d="M22 12h39l18 19v66H22zM61 12v20h18M34 45h32M34 56h32M34 67h18"/><circle cx="64" cy="79" r="12"/><path d="m73 88 13 13"/></svg><strong>논문찾기</strong><span>DBpia에서 논문 찾아보기 ↗</span></a>
          <div class="resource-account"><h2>천안월봉고등학교 계정</h2><p>DBpia 기관로그인</p>
            <div class="credential-row"><span>ID: <code>cwbhs</code></span><button type="button" data-copy="cwbhs" data-label="아이디">아이디 복사</button></div>
            <div class="credential-row"><span>PW: <code>cwbhs2003</code></span><button type="button" data-copy="cwbhs2003" data-label="비밀번호">비밀번호 복사</button></div>
            <button type="button" class="copy-account" data-copy="ID: cwbhs&#10;PW: cwbhs2003" data-label="계정 정보">계정 정보 전체 복사</button>
            <p class="copy-status" role="status" aria-live="polite"></p>
          </div>
        </section>
        <section class="resource-card"><a class="resource-link" href="https://read365.edunet.net/PureScreen/SchoolSearch?neisCode=N100002464&amp;provCode=N10&amp;schoolName=천안월봉고등학교" target="_blank" rel="noopener noreferrer"><svg viewBox="0 0 100 110" fill="none" aria-hidden="true"><path d="M50 27C37 16 22 17 10 22v65c14-5 27-3 40 7 13-10 26-12 40-7V22c-12-5-27-6-40 5Zm0 0v67M21 36c7-1 13 1 19 4M21 49c7-1 13 1 19 4M60 40c6-3 12-5 19-4M60 53c6-3 12-5 19-4"/></svg><strong>도서찾기</strong><span>독서로에서 우리 학교 도서 찾아보기 ↗</span></a><p class="resource-note">천안월봉고등학교 도서 검색으로 연결돼요.</p></section>
      </div>`;
    page.querySelectorAll('[data-copy]').forEach(button => button.onclick = async () => {
      const status = page.querySelector('.copy-status');
      try {
        await copyText(button.dataset.copy);
        status.textContent = button.dataset.label + '를 복사했어요.';
      } catch (error) {
        status.textContent = '복사하지 못했어요. 위의 계정 정보를 길게 누르거나 드래그해서 복사해 주세요.';
      }
    });
  }

  async function renderClass24() {
    seatEditMode = false;
    seatEditorId = '';
    fullSeatDraft = null;
    selectedSeatStudent = '';
    seatSaving = false;
    page.innerHTML = `<div class="eyebrow"><span></span>OUR CLASSROOM 2-4</div>
      <section class="board-hero class24-hero"><div><h1>2-4</h1><p>우리 반 자리표와 생일 정보를 한눈에 확인해요.</p></div><button id="seat-edit" class="tiny-button" type="button">자리 바꾸기</button></section>
      <p id="class24-status" class="board-status" role="status"></p>
      <section id="seat-layout" class="seat-layout" aria-label="2-4 자리표"></section>
      <section id="birthday-board" class="birthday-board" aria-label="생일 정보"></section>`;
    const status = document.getElementById('class24-status');
    const version = revision;
    status.textContent = '자리표와 생일 정보를 불러오고 있어요…';
    try {
      const seatsRes = await app.api('seats');
      const profilesRes = await app.api('profiles');
      if (version !== revision || current !== 'class24') return;
      seatProfiles = Object.fromEntries(profilesRes.profiles.map(profile => [profile.id, profile]));
      renderSeatLayout(seatsRes.seats, status);
      renderBirthdayBoard(profilesRes.profiles);
      acknowledge('class24', seatsRes.revision);
      status.textContent = '';
      document.getElementById('seat-edit').onclick = () => {
        if (seatSaving) return;
        if (fullSeatDraft) { status.textContent = '전체 자리 배치를 저장하거나 취소해 주세요.'; return; }
        const id = window.prompt('자리 수정 권한 확인용 학번을 입력해 주세요.');
        if (!id || !SEAT_EDITORS.includes(id.trim())) {
          window.alert('권한이 없습니다.');
          return;
        }
        if (app.getUser()?.id !== id.trim()) {
          window.alert('입력한 학번과 로그인 계정이 다릅니다.');
          return;
        }
        seatEditorId = id.trim();
        showSeatEditChoices(seatsRes.seats, status);
      };
    } catch (error) {
      status.textContent = error.message || '정보를 불러오지 못했어요.';
    }
  }

  function showSeatEditChoices(seats, status) {
    const dialog = el('dialog', 'seat-mode-dialog');
    dialog.setAttribute('aria-label', '자리 바꾸기 방식 선택');
    dialog.append(el('h2', '', '자리를 어떻게 바꿀까요?'));
    const choices = el('div', 'seat-edit-actions');
    for (const [label, full] of [['전체 바꾸기', true], ['일부 바꾸기', false]]) {
      const button = el('button', 'tiny-button', label);
      button.type = 'button';
      button.onclick = () => {
        seatEditMode = !full;
        fullSeatDraft = full ? seats.map(item => ({ slot: item.slot, student_id: '' })) : null;
        selectedSeatStudent = '';
        status.textContent = full
          ? '아래 학생 프로필을 선택한 뒤 빈자리를 눌러 주세요. 배치된 학생을 누르면 대기 목록으로 돌아가요.'
          : '일부 자리 수정 모드예요. 프로필 카드를 드래그해서 자리 이동하세요.';
        dialog.close();
        renderSeatLayout(seats, status);
      };
      choices.append(button);
    }
    const cancel = el('button', 'tiny-button', '취소');
    cancel.type = 'button';
    cancel.onclick = () => dialog.close();
    choices.append(cancel);
    dialog.append(el('p', '', '전체: 책상 배치를 유지하고 모든 학생을 다시 배치해요. 일부: 드래그해서 두 학생의 자리를 맞바꿔요.'), choices);
    dialog.addEventListener('close', () => dialog.remove());
    page.append(dialog);
    dialog.showModal();
  }

  function renderSeatWaitingList(board, seats, status) {
    const assigned = new Set(fullSeatDraft.map(item => item.student_id).filter(Boolean));
    const ids = [...new Set(seats.map(item => item.student_id).filter(Boolean))].sort();
    const waiting = ids.filter(id => !assigned.has(id));
    const panel = el('section', 'seat-waiting');
    panel.setAttribute('aria-label', '자리 배치 대기 학생');
    panel.append(el('h2', '', `배치할 학생 ${waiting.length}명`),
      el('p', '', '학생 프로필 → 빈자리 순서로 눌러 배치하세요. 배치된 학생을 누르면 아래로 돌아와요.'));
    const list = el('div', 'seat-waiting-list');
    waiting.forEach(id => {
      const card = el('button', 'seat-cell seat-waiting-card');
      card.type = 'button';
      card.disabled = seatSaving;
      card.setAttribute('aria-pressed', String(selectedSeatStudent === id));
      card.append(avatarBubble(seatProfiles[id]), el('span', 'seat-name', profileNameText(seatProfiles[id]) === '미지정' ? id : profileNameText(seatProfiles[id])), el('small', 'seat-id', id));
      card.onclick = () => {
        selectedSeatStudent = selectedSeatStudent === id ? '' : id;
        status.textContent = selectedSeatStudent ? `${profileNameText(seatProfiles[id])} 학생을 배치할 빈자리를 눌러 주세요.` : '배치할 학생을 선택해 주세요.';
        renderSeatLayout(seats, status);
      };
      list.append(card);
    });
    const actions = el('div', 'seat-edit-actions');
    const save = el('button', 'tiny-button', seatSaving ? '저장 중…' : '전체 배치 저장');
    const cancel = el('button', 'tiny-button', '취소');
    save.type = cancel.type = 'button';
    save.disabled = seatSaving || waiting.length > 0 || fullSeatDraft.some(item => !item.student_id);
    cancel.disabled = seatSaving;
    cancel.onclick = () => {
      fullSeatDraft = null;
      selectedSeatStudent = '';
      renderSeatLayout(seats, status);
      status.textContent = '전체 자리 바꾸기를 취소했어요. 기존 자리표를 유지해요.';
    };
    save.onclick = async () => {
      if (seatSaving || save.disabled) return;
      seatSaving = true;
      const version = revision;
      const payload = Object.fromEntries(fullSeatDraft.map(item => [item.slot, item.student_id]));
      renderSeatLayout(seats, status);
      status.textContent = '전체 자리 배치를 저장하고 있어요…';
      try {
        const result = await app.api('seats', { editor_id: seatEditorId, seats: payload });
        if (version !== revision || current !== 'class24') return;
        seats.splice(0, seats.length, ...result.seats);
        fullSeatDraft = null;
        selectedSeatStudent = '';
        status.textContent = '전체 자리 배치를 저장했어요.';
      } catch (error) {
        if (version !== revision || current !== 'class24') return;
        status.textContent = error.message || '저장하지 못했어요. 다시 시도해 주세요.';
      } finally {
        if (version === revision && current === 'class24') {
          seatSaving = false;
          renderSeatLayout(seats, status);
        }
      }
    };
    actions.append(save, cancel);
    panel.append(list, actions);
    board.append(panel);
  }

  function slotSort(a, b) {
    const p = value => {
      const m = /^G(\d)R(\d+)([LR])$/.exec(value);
      return [Number(m[1]), Number(m[2]), m[3] === 'L' ? 0 : 1];
    };
    const aa = p(a), bb = p(b);
    for (let i = 0; i < 3; i++) if (aa[i] !== bb[i]) return aa[i] - bb[i];
    return 0;
  }

  function avatarBubble(profile) {
    const holder = el('span', 'seat-avatar');
    const fallback = el('span', 'seat-avatar-fallback', profile?.role === 'teacher' ? '쌤' : (profile?.id || '--').slice(-2));
    const image = document.createElement('img');
    image.src = '/api/avatars/' + encodeURIComponent(profile?.id || '');
    image.alt = '프로필 사진';
    image.className = 'seat-avatar-image';
    image.onerror = () => {
      holder.replaceChildren(fallback);
    };
    holder.append(image);
    return holder;
  }

  async function saveSeatSwap(seats, fromSlot, toSlot, status) {
    const from = seats.find(item => item.slot === fromSlot);
    const to = seats.find(item => item.slot === toSlot);
    if (!from || !to || from.slot === to.slot) return;
    const fromId = from.student_id;
    const toId = to.student_id;
    try {
      const saved = await app.api('seats', { editor_id: seatEditorId, seats: { [fromSlot]: toId, [toSlot]: fromId } });
      const savedMap = Object.fromEntries(saved.seats.map(item => [item.slot, item.student_id]));
      seats.forEach(item => { item.student_id = savedMap[item.slot] || item.student_id; });
      renderSeatLayout(seats, status);
      status.textContent = `${fromSlot} ↔ ${toSlot} 자리 이동을 저장했어요.`;
    } catch (error) {
      status.textContent = error.message || '자리 수정에 실패했어요.';
    }
  }

  function renderSeatLayout(seats, status) {
    const board = document.getElementById('seat-layout');
    const bySlot = Object.fromEntries((fullSeatDraft || seats).map(item => [item.slot, item.student_id]));
    board.replaceChildren();
    const allDesk = el('section', 'seat-all-wrap');
    let draggingSlot = '';
    for (let group = 1; group <= 4; group++) {
      const rows = group === 1 ? 5 : 4;
      const section = el('section', 'seat-group');
      section.append(el('h2', '', `${group}분단`));
      const rowWrap = el('div', 'seat-rows');
      for (let row = 1; row <= rows; row++) {
        const rowBox = el('div', 'seat-row');
        for (const side of ['L', 'R']) {
          const slot = `G${group}R${row}${side}`;
          const sid = bySlot[slot] || '';
          const profile = seatProfiles[sid];
          const seat = el('button', 'seat-cell');
          seat.type = 'button';
          seat.title = slot;
          seat.dataset.slot = slot;
          seat.draggable = seatEditMode;
          seat.append(avatarBubble(profile), el('span', 'seat-name', profileNameText(profile)), el('small', 'seat-id', sid || '미지정'));
          if (fullSeatDraft) {
            seat.draggable = false;
            seat.disabled = seatSaving;
            seat.classList.add('seat-full-edit');
            if (!sid) seat.replaceChildren(el('span', 'seat-name', '빈자리'), el('small', 'seat-id', `${row}행 ${side === 'L' ? '왼쪽' : '오른쪽'}`));
            seat.setAttribute('aria-label', `${group}분단 ${row}행 ${side === 'L' ? '왼쪽' : '오른쪽'}: ${sid ? profileNameText(profile) : '빈자리'}`);
            seat.onclick = () => {
              if (seatSaving) return;
              const target = fullSeatDraft.find(item => item.slot === slot);
              if (target.student_id) {
                selectedSeatStudent = target.student_id;
                target.student_id = '';
                status.textContent = '학생을 대기 목록으로 옮겼어요. 다시 배치할 빈자리를 눌러 주세요.';
              } else if (selectedSeatStudent) {
                target.student_id = selectedSeatStudent;
                selectedSeatStudent = '';
                status.textContent = '배치했어요. 다음 학생을 선택해 주세요.';
              } else {
                status.textContent = '아래에서 배치할 학생 프로필을 먼저 선택해 주세요.';
              }
              renderSeatLayout(seats, status);
            };
          } else if (seatEditMode) {
            seat.classList.add('editable');
            seat.addEventListener('dragstart', event => {
              draggingSlot = slot;
              seat.classList.add('dragging');
              if (event.dataTransfer) {
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', slot);
              }
            });
            seat.addEventListener('dragend', () => {
              seat.classList.remove('dragging');
              draggingSlot = '';
            });
            seat.addEventListener('dragover', event => {
              if (!draggingSlot || draggingSlot === slot) return;
              event.preventDefault();
              seat.classList.add('drag-over');
            });
            seat.addEventListener('dragleave', () => {
              seat.classList.remove('drag-over');
            });
            seat.addEventListener('drop', async event => {
              event.preventDefault();
              seat.classList.remove('drag-over');
              const fromSlot = event.dataTransfer?.getData('text/plain') || draggingSlot;
              if (!fromSlot || fromSlot === slot) return;
              await saveSeatSwap(seats, fromSlot, slot, status);
            });
          } else {
            seat.disabled = true;
          }
          rowBox.append(seat);
        }
        rowWrap.append(rowBox);
      }
      section.append(rowWrap);
      allDesk.append(section);
    }
    board.append(allDesk);
    if (fullSeatDraft) renderSeatWaitingList(board, seats, status);
  }

  function daysUntil(month, day) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let target = new Date(today.getFullYear(), month - 1, day);
    if (target < today) target = new Date(today.getFullYear() + 1, month - 1, day);
    return Math.floor((target - today) / 86400000);
  }

  function renderBirthdayBoard(profiles) {
    const section = document.getElementById('birthday-board');
    section.replaceChildren();
    section.append(el('h2', '', '생일 정보'));

    const students = profiles
      .filter(profile => profile.role === 'student' && profile.birthday)
      .map(profile => {
        const [mm, dd] = profile.birthday.split('-').map(Number);
        return {
          ...profile,
          month: mm,
          day: dd,
          distance: daysUntil(mm, dd),
          displayName: profile.name || profile.id
        };
      });

    if (!students.length) {
      section.append(el('p', 'empty-note', '등록된 생일 정보가 없어요.'));
      return;
    }

    const todays = students.filter(item => item.distance === 0);
    if (todays.length) {
      const todayBox = el('section', 'birthday-today');
      todayBox.append(el('h3', '', '오늘 생일'));
      const names = el('p', '', todays.map(item => `${item.displayName} (${item.id})`).join(', '));
      todayBox.append(names);
      section.append(todayBox);
    }

    const months = [...new Set(students.map(item => item.month))].sort((a, b) => {
      const da = Math.min(...students.filter(item => item.month === a).map(item => item.distance));
      const db = Math.min(...students.filter(item => item.month === b).map(item => item.distance));
      return da - db;
    });

    months.forEach(month => {
      const block = el('section', 'birthday-month');
      block.append(el('h3', '', `${month}월`));
      const list = el('div', 'birthday-list');
      students
        .filter(item => item.month === month)
        .sort((a, b) => a.distance - b.distance || a.day - b.day)
        .forEach(item => {
          const card = el('article', 'birthday-card');
          card.append(el('strong', '', `${item.displayName} (${item.id})`), el('p', '', `${item.month}월 ${item.day}일 · ${item.distance === 0 ? '오늘' : item.distance + '일 후'}`));
          list.append(card);
        });
      block.append(list);
      section.append(block);
    });
  }

  async function copyText(value) {
    if (window.isSecureContext && navigator.clipboard) {
      try { await navigator.clipboard.writeText(value); return; } catch (error) {}
    }
    const field = document.createElement('textarea'), previous = document.activeElement;
    field.value = value;
    field.readOnly = true;
    field.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.append(field);
    try {
      field.select();
      field.setSelectionRange(0, field.value.length);
      if (!document.execCommand('copy')) throw new Error('copy failed');
    } finally {
      field.remove();
      if (previous) previous.focus();
    }
  }

  function boardHeader(kind) {
    if (kind === 'photos') {
      page.innerHTML = `<div class="eyebrow"><span></span>OUR LITTLE MEMORIES</div><section class="board-hero"><div><h1>우리 반 학급앨범 <span class="board-count" id="board-count"></span></h1><p>함께한 순간을 한 장씩 모아 보세요 📷</p></div><button id="create-post" class="primary-button">+ 사진 올리기</button></section><p id="board-status" class="board-status" role="status"></p><div id="board-items" class="photo-grid" aria-live="polite"></div>`;
      document.getElementById('create-post').onclick = () => composePhoto();
      return;
    }

    const config = boardConfig[kind];
    page.innerHTML = `<div class="eyebrow"><span></span>${config.eyebrow}</div><section class="board-hero"><div><h1>${config.title} <span class="board-count" id="board-count"></span></h1><p>${config.description}</p></div><button id="create-post" class="primary-button">${config.button}</button></section><p id="board-status" class="board-status" role="status"></p><div id="board-items" class="board-list" aria-live="polite"></div>`;
    document.getElementById('create-post').onclick = () => composePost(kind);
  }

  async function renderBoard(kind, success = '') {
    boardHeader(kind);
    const version = revision;
    const status = document.getElementById('board-status');
    status.textContent = '게시물을 불러오고 있어요…';
    try {
      const data = await app.api(kind);
      if (version !== revision || current !== kind) return;
      status.textContent = success;
      acknowledge(kind, data.revision);
      const items = data[kind], container = document.getElementById('board-items');
      document.getElementById('board-count').textContent = String(items.length).padStart(2, '0');
      if (!items.length) {
        container.className = '';
        const empty = el('div', 'empty-state');
        if (kind === 'photos') empty.append(el('span', '', '📷'), document.createTextNode('우리 반의 첫 추억을 올려 주세요.'));
        else empty.append(el('span', '', '✳'), document.createTextNode(boardConfig[kind].empty));
        container.append(empty);
        return;
      }
      items.forEach(item => container.append(kind === 'photos' ? photoCard(item) : postCard(kind, item)));
    } catch (error) {
      if (version === revision) status.textContent = error.message || '게시물을 불러오지 못했어요. 다시 눌러 주세요.';
    }
  }

  function postCard(kind, item) {
    const user = app.getUser();
    const card = el('article', 'assignment-card');
    const meta = el('div', 'assignment-meta');
    meta.append(el('span', 'subject-badge', item.subject), el('span', '', dateText(item.created_at) + ' 작성'));
    card.append(meta, el('h2', '', item.title), el('p', 'assignment-date', '시행 날짜 · ' + dateText(item.scheduled_date + 'T12:00:00')));
    if (item.has_image) {
      const imageWrap = el('div', 'assignment-image-wrap');
      const image = el('img', 'assignment-image');
      image.src = `/api/${kind}/${item.id}/image`;
      image.alt = `${item.title} 첨부 사진`;
      image.loading = 'lazy';
      imageWrap.append(image);
      card.append(imageWrap);
    }
    card.append(el('p', 'assignment-content', item.content), el('p', 'assignment-author', '작성자 · ' + authorText(item.author, item.author_name)));
    if (user && user.id === item.author) {
      const actions = el('div', 'post-actions');
      const editButton = el('button', 'text-button', '수정');
      const deleteButton = el('button', 'text-button danger', '삭제');
      editButton.type = 'button';
      deleteButton.type = 'button';
      editButton.onclick = () => composePost(kind, item);
      deleteButton.onclick = async () => {
        if (!window.confirm('이 게시물을 삭제할까요?')) return;
        try {
          await app.api(`${kind}/${item.id}/delete`, {});
          revision++;
          renderBoard(kind, '게시물을 삭제했어요.');
        } catch (error) {
          const status = document.getElementById('board-status');
          if (status) status.textContent = error.message || '삭제하지 못했어요.';
        }
      };
      actions.append(editButton, deleteButton);
      card.append(actions);
    }
    return card;
  }

  function photoCard(item) {
    const card = el('figure', 'polaroid'), image = el('img');
    image.src = `/api/photos/${item.id}/preview`;
    image.alt = item.caption || '우리 반 사진';
    image.loading = 'lazy';
    image.draggable = false;
    const caption = el('figcaption');
    caption.append(el('p', 'photo-caption', item.caption || '우리의 작은 순간'), el('p', 'photo-meta', authorText(item.author, item.author_name) + ' · ' + dateText(item.created_at)));
    if (app.getUser()?.role === 'teacher') {
      const download = el('a', 'download-photo', '↓ 보관본 다운로드');
      download.href = `/api/photos/${item.id}/download`;
      download.setAttribute('download', '');
      caption.append(download);
    }
    card.append(image, caption);
    return card;
  }

  async function prepareAlbumPhoto(file) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      throw new Error('JPG, PNG, WebP 사진을 골라 주세요.');
    }
    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
      const needsCompression = file.size > 10 * 1024 * 1024 || bitmap.width * bitmap.height > 25000000;
      if (!needsCompression) return await albumDataURL(file);
      const target = file.size > 500 * 1024 * 1024 ? 500 * 1024 : 8 * 1024 * 1024;
      const scale = Math.min(1, 4096 / bitmap.width, 4096 / bitmap.height);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      let blob;
      for (let attempt = 0; attempt < 18; attempt++) {
        blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', Math.max(.45, .9 - attempt * .08)));
        if (!blob) throw new Error('사진 압축에 실패했어요.');
        if (blob.size <= target) return await albumDataURL(blob);
        if (attempt >= 5) {
          const smaller = document.createElement('canvas');
          smaller.width = Math.max(1, Math.floor(canvas.width * .8));
          smaller.height = Math.max(1, Math.floor(canvas.height * .8));
          smaller.getContext('2d').drawImage(canvas, 0, 0, smaller.width, smaller.height);
          canvas.width = smaller.width;
          canvas.height = smaller.height;
          context.drawImage(smaller, 0, 0);
        }
      }
      throw new Error('사진을 충분히 줄이지 못했어요. 사진 크기를 줄인 뒤 다시 시도해 주세요.');
    } catch (error) {
      throw new Error(error.message || '사진을 읽지 못했어요. 기기에서 사진 크기를 줄인 뒤 다시 시도해 주세요.');
    } finally {
      bitmap?.close();
    }
  }

  function albumDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('사진을 읽지 못했어요.'));
      reader.readAsDataURL(file);
    });
  }

  function composePhoto() {
    revision++;
    page.innerHTML = `<section class="board-form"><button id="compose-back" class="text-button">← 학급앨범으로 돌아가기</button><h1>오늘의 추억을 남겨 보세요 📷</h1><p class="account-lead">여러 장을 골라 함께 올릴 수 있어요.</p><form id="post-form" class="account-card"><label for="photo-file">사진 선택 (여러 장 가능)</label><input id="photo-file" type="file" accept="image/jpeg,image/png,image/webp" multiple required><p class="photo-upload-note">JPG · PNG · WebP / 큰 사진은 자동으로 줄여 저장해요.<br>한 장이 500MB를 넘으면 500KB 이하로 압축해요. 10MB 초과 사진은 업로드에 맞게 줄여요.<br>압축하면 화질과 해상도가 낮아지며, 선생님은 저장된 보관본을 다운로드할 수 있어요.</p><p id="selected-photos" role="status"></p><label for="photo-caption">사진에 남길 한마디 (선택, 모든 사진에 적용)</label><textarea id="photo-caption" name="caption" maxlength="140" placeholder="오늘의 추억을 짧게 적어 주세요"></textarea><button type="submit" class="primary-button">사진 올리기</button><p id="post-message" class="form-message" role="status"></p></form></section>`;
    const form = document.getElementById('post-form'), message = document.getElementById('post-message');
    const input = document.getElementById('photo-file');
    const back = document.getElementById('compose-back');
    let pending = [], uploading = false;
    back.onclick = () => { if (!uploading) { revision++; renderBoard('photos'); } };
    input.onchange = () => {
      pending = Array.from(input.files);
      document.getElementById('selected-photos').textContent = `${pending.length}장 선택됨`;
      message.textContent = '';
    };
    form.onsubmit = async event => {
      event.preventDefault();
      if (uploading || !pending.length) return;
      const button = form.querySelector('[type="submit"]');
      uploading = button.disabled = input.disabled = back.disabled = true;
      const caption = document.getElementById('photo-caption').value;
      const total = pending.length;
      let completed = 0;
      try {
        // Remove only acknowledged uploads; retry continues with remaining files.
        while (pending.length) {
          const file = pending[0];
          message.textContent = `${completed + 1}/${total}장 처리 중: ${file.name}`;
          const data = await prepareAlbumPhoto(file);
          await app.api('photos', {caption, image: data.split(',')[1]});
          pending.shift();
          completed++;
        }
        revision++;
        renderBoard('photos', `${completed}장의 사진을 올렸어요 📷`);
        window.scrollTo(0, 0);
      } catch (error) {
        message.textContent = `${completed}장 저장됨 · ${pending.length}장 남음. ${error.message || '연결을 확인해 주세요.'} 다시 누르면 남은 사진부터 올려요.`;
        document.getElementById('selected-photos').textContent = `${pending.length}장 남음`;
      } finally {
        uploading = button.disabled = input.disabled = back.disabled = false;
      }
    };
    window.scrollTo(0, 0);
  }

  function composePost(kind, existing) {
    revision++;
    const composeVersion = revision;
    const config = boardConfig[kind];
    const editing = Boolean(existing);
    page.innerHTML = `<section class="board-form"><button id="compose-back" class="text-button">← ${config.backLabel}으로 돌아가기</button><h1>${editing ? config.title + ' 수정하기' : config.writeTitle}</h1><p class="account-lead">${editing ? '작성한 내용을 고쳐서 다시 저장해 주세요.' : config.writeLead}</p><form id="post-form" class="account-card"><label for="post-title">제목</label><input id="post-title" name="title" maxlength="100" placeholder="예: 국어 발표 수행평가 안내" required><div class="form-row"><div><label for="post-subject">과목</label><input id="post-subject" name="subject" maxlength="30" placeholder="예: 국어" required></div><div><label for="post-date">시행 날짜</label><input id="post-date" type="date" name="scheduled_date" min="0001-01-01" max="9999-12-31" required></div></div><label for="post-content">내용</label><textarea id="post-content" name="content" maxlength="8000" placeholder="평가 내용, 준비물, 주의할 점 등을 써 주세요" required></textarea><label for="post-image">첨부 사진 (선택)</label><input id="post-image" type="file" accept="image/jpeg,image/png,image/webp"><p class="photo-upload-note">JPG · PNG · WebP / 최대 10MB</p><figure id="post-upload-preview" class="polaroid photo-preview" hidden><img id="post-upload-preview-image" alt="첨부할 사진 미리보기"><figcaption>첨부 사진 미리보기</figcaption></figure>${editing && existing.has_image ? '<label class="inline-checkbox"><input type="checkbox" id="remove-post-image">기존 첨부 사진 삭제하기</label>' : ''}<button type="submit" class="primary-button">${editing ? '수정 저장하기' : '게시물 등록하기'}</button><p id="post-message" class="form-message" role="status"></p></form></section>`;

    document.getElementById('compose-back').onclick = () => {
      revision++;
      renderBoard(kind);
    };

    const form = document.getElementById('post-form');
    const message = document.getElementById('post-message');
    form.title.value = existing?.title || '';
    form.subject.value = existing?.subject || '';
    form.scheduled_date.value = existing?.scheduled_date || '';
    form.content.value = existing?.content || '';

    let imageData = null;
    let selectedFile = null;
    const imageInput = document.getElementById('post-image');
    const preview = document.getElementById('post-upload-preview');

    imageInput.onchange = async event => {
      const file = event.target.files[0];
      selectedFile = file;
      imageData = null;
      preview.hidden = true;
      message.textContent = '';
      if (!file) return;
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) {
        message.textContent = '10MB 이하의 JPG, PNG, WebP 사진을 골라 주세요.';
        event.target.value = '';
        return;
      }
      try {
        const data = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error('사진을 읽지 못했어요. 다시 골라 주세요.'));
          reader.readAsDataURL(file);
        });
        if (selectedFile !== file || revision !== composeVersion || !document.getElementById('post-upload-preview')) return;
        imageData = data.split(',')[1];
        document.getElementById('post-upload-preview-image').src = data;
        preview.hidden = false;
      } catch (error) {
        message.textContent = error.message;
      }
    };

    form.onsubmit = async event => {
      event.preventDefault();
      const button = form.querySelector('[type="submit"]');
      button.disabled = true;
      message.textContent = editing ? '게시물을 수정하고 있어요…' : '게시물을 저장하고 있어요…';
      const version = revision;
      try {
        const data = {
          title: form.title.value,
          subject: form.subject.value,
          scheduled_date: form.scheduled_date.value,
          content: form.content.value
        };
        if (imageData) data.image = imageData;
        if (editing && document.getElementById('remove-post-image')?.checked) data.remove_image = true;
        if (editing) await app.api(`${kind}/${existing.id}/edit`, data);
        else await app.api(kind, data);
        if (version !== revision) return;
        revision++;
        renderBoard(kind, editing ? config.successEdit : config.successCreate);
        window.scrollTo(0, 0);
      } catch (error) {
        message.textContent = error.message || '저장하지 못했어요. 연결을 확인하고 다시 시도해 주세요.';
      } finally {
        button.disabled = false;
      }
    };

    window.scrollTo(0, 0);
  }
})();
