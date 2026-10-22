'use strict';
(() => {
  const page = document.getElementById('account-page');
  const calendar = document.getElementById('calendar-page');
  const nav = document.getElementById('profile-nav');
  let me = null;
  let viewVersion = 0;
  async function api(path, data) {
    const response = await fetch('/api/' + path, data === undefined ? {cache:'no-store'} : {
      method:'POST', headers:{'Content-Type':'application/json','X-Class-Board':'1'}, body:JSON.stringify(data)
    });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 401 && path !== 'login') {me = null; loginView();}
      throw new Error(result.error || '다시 시도해 주세요냥.');
    }
    return result;
  }
  function accountView(html) {
    viewVersion++;
    document.getElementById('home-page').hidden=true;
    document.getElementById('boards-page').hidden=true;
    document.dispatchEvent(new CustomEvent('classboard:view',{detail:{kind:'account',user:me}}));
    calendar.hidden = true; page.hidden = false;
    nav.hidden = !me || Boolean(me.must_change);
    page.innerHTML = `<div class="account-shell">${html}</div>`;
    window.scrollTo(0,0);
  }
  function message(text) { const target=document.getElementById('form-message'); if(target)target.textContent=text; }
  function submit(form, task) {
    form.addEventListener('submit', async event => {
      event.preventDefault(); const button=form.querySelector('[type="submit"]');button.disabled=true;message('');
      try { await task(new FormData(form)); } catch(error) {message(error.message || '연결을 확인하고 다시 시도해 주세요냥.');}
      finally {button.disabled=false;}
    });
  }
  function loginView() {
    accountView(`<p class="account-kicker">WELCOME TO OUR CLASS</p><h1>반가워요,<br>2-4반 친구들 🐾</h1><p class="account-lead">우리 반의 하루를 만나러 왔냥?<br>내 아이디로 로그인해 주세요냥.</p><form id="login-form" class="account-card"><label for="login-id">학번 또는 선생님 아이디</label><input id="login-id" name="id" autocomplete="username" autocapitalize="none" spellcheck="false" enterkeyhint="next" placeholder="학번을 입력해 주세요" required maxlength="30"><label for="login-password">비밀번호</label><input id="login-password" name="password" type="password" autocomplete="current-password" placeholder="비밀번호를 입력해 주세요" required maxlength="128"><button class="primary-button" type="submit">로그인하기 🐾</button><p id="form-message" class="form-message" role="alert"></p></form><p class="form-hint">처음 로그인하는 학생의 비밀번호는 1234예요.<br>로그인 후 나만의 비밀번호로 바꿔 주세요냥.</p>`);
    submit(document.getElementById('login-form'), async form => {
      const result=await api('login',Object.fromEntries(form));me=result.user;
      if(me.must_change) passwordView(true); else showHome();
    });
  }
  function passwordView(first) {
    accountView(`<p class="account-kicker">${first?'FIRST HELLO':'MY ACCOUNT'}</p><h1>${first?'나만의 비밀번호를<br>정해 주세요냥 🔐':'비밀번호 바꾸기 🔐'}</h1><p class="account-lead">${first?'처음 로그인했으니 비밀번호를 먼저 바꿔요.<br>변경을 마치면 우리 반 게시판이 열려요냥.':'다른 친구들이 모르는 비밀번호로 정해 주세요냥.'}</p><form id="password-form" class="account-card"><input name="username" autocomplete="username" hidden>${first?'':'<label for="current-password">현재 비밀번호</label><input id="current-password" name="current" type="password" autocomplete="current-password" maxlength="128" required>'}<label for="new-password">새 비밀번호</label><input id="new-password" name="password" type="password" autocomplete="new-password" minlength="8" maxlength="128" placeholder="8자 이상 입력해 주세요" required><label for="confirm-password">새 비밀번호 확인</label><input id="confirm-password" name="confirm" type="password" autocomplete="new-password" minlength="8" maxlength="128" placeholder="한 번 더 입력해 주세요" required><button class="primary-button" type="submit">비밀번호 저장하기</button><p id="form-message" class="form-message" role="alert"></p></form><div class="profile-actions"><button id="password-back" class="text-button">${first?'다른 계정으로 로그인':'프로필로 돌아가기'}</button></div>`);
    document.querySelector('[name="username"]').value=me.id;
    document.getElementById('password-back').onclick=first?logout:profileView;
    submit(document.getElementById('password-form'),async form=>{
      if(form.get('password')!==form.get('confirm'))throw new Error('새 비밀번호가 서로 달라요. 다시 확인해 주세요냥.');
      const result=await api('password',{password:form.get('password'),current:form.get('current')});me=result.user;
      if(first)showHome();else{profileView();message('비밀번호를 바꿨어요냥 🐾');}
    });
  }
  function showCalendar() {
    document.getElementById('home-page').hidden=true;
    viewVersion++;page.hidden=true;calendar.hidden=false;nav.hidden=false;
    document.getElementById('boards-page').hidden=true;
    document.dispatchEvent(new CustomEvent('classboard:view',{detail:{kind:'calendar',user:me}}));
    window.scrollTo(0,0);
  }
  function showBoard(kind) {
    if(!me)return loginView();
    if(me.must_change)return passwordView(true);
    viewVersion++;page.hidden=true;calendar.hidden=true;nav.hidden=false;
    document.getElementById('home-page').hidden=true;
    document.getElementById('boards-page').hidden=false;
    document.dispatchEvent(new CustomEvent('classboard:view',{detail:{kind,user:me}}));
    window.scrollTo(0,0);
  }
  function showHome() {
    if(!me)return loginView();
    if(me.must_change)return passwordView(true);
    viewVersion++;page.hidden=true;calendar.hidden=true;nav.hidden=false;
    document.getElementById('boards-page').hidden=true;
    document.getElementById('home-page').hidden=false;
    document.dispatchEvent(new CustomEvent('classboard:view',{detail:{kind:'home',user:me}}));
    window.scrollTo(0,0);
  }
  function profileView() {
    if(!me)return loginView();
    if(me.must_change)return passwordView(true);
    accountView(`<div class="profile-top"><h1>내 프로필 🐾</h1><button id="calendar-back" class="text-button">학사일정으로 ↗</button></div><div class="profile-id"><span class="avatar" id="my-avatar"></span><div><strong id="my-id"></strong><small id="my-role"></small></div></div><p class="account-lead">내 생일과 인스타를 친구들에게 알려줘냥.<br>입력한 정보는 로그인한 우리 반 친구들이 볼 수 있어요.</p><form id="profile-form" class="account-card"><label for="birth-month">생일 (선택)</label><div class="birthday-fields"><select id="birth-month" name="month" aria-label="태어난 월"><option value="">월 선택</option></select><select id="birth-day" name="day" aria-label="태어난 일"><option value="">일 선택</option></select></div><label for="instagram">인스타그램 아이디 (선택)</label><input id="instagram" name="instagram" autocomplete="off" placeholder="@ 없이 아이디만 입력" maxlength="31" spellcheck="false"><p class="field-note">비워 두고 저장하면 정보를 지울 수 있어요냥.</p><button class="primary-button" type="submit">프로필 저장하기</button><p id="form-message" class="form-message" role="status"></p></form><div class="profile-actions"><button id="change-password" class="text-button">비밀번호 변경</button><button id="logout" class="text-button">로그아웃</button></div><section class="friends-section"><h2>우리 반 친구들 🐾</h2><p>학번별 프로필이에요. 내 정보는 위에서 수정해 주세요냥.</p><div id="friends" aria-live="polite">프로필을 불러오고 있어요냥…</div></section>`);
    document.getElementById('my-id').textContent=me.name||me.id;
    document.getElementById('my-role').textContent=me.role==='teacher'?'강경민 · 우리 반 선생님':me.id+' · 2학년 4반 '+Number(me.id.slice(-2))+'번';
    const profileForm=document.getElementById('profile-form');
    const nameLabel=document.createElement('label');nameLabel.htmlFor='profile-name';nameLabel.textContent='이름 (선택)';
    const nameInput=document.createElement('input');nameInput.id='profile-name';nameInput.name='name';nameInput.maxLength=20;nameInput.autocomplete='name';nameInput.placeholder='친구들에게 보여줄 이름';nameInput.value=me.name||'';
    profileForm.prepend(nameLabel,nameInput);
    document.getElementById('my-avatar').textContent=me.role==='teacher'?'쌤':me.id.slice(-2);
    const month=document.getElementById('birth-month'),day=document.getElementById('birth-day');
    for(let i=1;i<=12;i++)month.add(new Option(`${i}월`,String(i).padStart(2,'0')));
    function updateDays(value='') {
      day.replaceChildren(new Option('일 선택',''));
      const count=month.value?new Date(2000,Number(month.value),0).getDate():31;
      for(let i=1;i<=count;i++)day.add(new Option(`${i}일`,String(i).padStart(2,'0')));
      day.value=Number(value)<=count?value:'';
    }
    month.value=me.birthday.slice(0,2);updateDays(me.birthday.slice(3));month.onchange=()=>updateDays(day.value);
    document.getElementById('instagram').value=me.instagram;
    document.getElementById('calendar-back').onclick=showCalendar;
    document.getElementById('change-password').onclick=()=>passwordView(false);
    document.getElementById('logout').onclick=logout;
    submit(document.getElementById('profile-form'),async form=>{
      if(Boolean(form.get('month'))!==Boolean(form.get('day')))throw new Error('생일의 월과 일을 모두 골라 주세요냥.');
      const result=await api('profile',{name:form.get('name'),birthday:form.get('month')?`${form.get('month')}-${form.get('day')}`:'',instagram:form.get('instagram')});
      me=result.user;document.getElementById('my-id').textContent=me.name||me.id;message('프로필을 저장했어요냥 🐾');loadFriends();
    });
    loadFriends();
  }
  async function loadFriends() {
    const version=viewVersion;
    try {
      const result=await api('profiles');
      if(version!==viewVersion)return;
      const container=document.getElementById('friends');if(!container)return;container.replaceChildren();
      result.profiles.forEach(profile=>{
        const card=document.createElement('div');card.className='friend-card';
        const avatar=document.createElement('span');avatar.className='avatar';avatar.textContent=profile.role==='teacher'?'쌤':profile.id.slice(-2);
        const detail=document.createElement('div');detail.className='friend-detail';
        const name=document.createElement('strong');name.textContent=(profile.name?profile.name+' · ':'')+profile.id+(profile.role==='teacher'?' 선생님':'')+(profile.id===me.id?' · 나':'');detail.append(name);
        const birthday=document.createElement('p');birthday.textContent=profile.birthday?`🎂 ${Number(profile.birthday.slice(0,2))}월 ${Number(profile.birthday.slice(3))}일`:'생일 미설정';detail.append(birthday);
        if(profile.instagram){const p=document.createElement('p'),link=document.createElement('a');link.textContent='@'+profile.instagram;link.href='https://www.instagram.com/'+encodeURIComponent(profile.instagram)+'/';link.target='_blank';link.rel='noopener noreferrer';p.append(link);detail.append(p)}
        card.append(avatar,detail);container.append(card);
      });
    }catch(error){if(version===viewVersion){const container=document.getElementById('friends');if(container)container.textContent=error.message;}}
  }
  async function logout() {
    try{await api('logout',{});me=null;loginView();}catch(error){message(error.message);}
  }
  nav.onclick=profileView;
  window.classBoard={api,getUser:()=>me,showCalendar,showBoard,showHome};
  if(location.protocol==='file:') {
    accountView('<h1>게시판을 켜 주세요냥 🐾</h1><p class="account-lead">로그인과 프로필을 저장하려면 서버가 필요해요.<br>이 폴더의 <b>게시판 시작.sh</b>를 실행한 뒤<br><a href="http://localhost:8080">http://localhost:8080</a>으로 접속해 주세요냥.</p>');
  } else {
    api('me').then(result=>{me=result.user;if(!me)loginView();else if(me.must_change)passwordView(true);else showHome()}).catch(()=>{
      accountView('<h1>연결을 확인해 주세요냥 🐾</h1><p class="account-lead">게시판 서버에 연결하고 있어요.<br>잠시 후 새로고침해 주세요냥.<br>계속 연결되지 않으면 게시판 관리자에게 알려 주세요.</p>');
    });
  }
})();
