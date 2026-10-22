'use strict';
(() => {
  const page=document.getElementById('boards-page');
  const navigation=document.getElementById('board-navigation');
  const app=window.classBoard;
  let current='calendar', revision=0;
  const el=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node};
  const dateText=value=>new Date(value).toLocaleDateString('ko-KR',{year:'numeric',month:'long',day:'numeric'});
  const authorText=(id,name)=>name?`${name} · ${id}`:id==='강경민'?'강경민 선생님':id;
  document.addEventListener('classboard:view',event=>{
    const {kind,user}=event.detail;revision++;current=kind;
    navigation.hidden=!user||Boolean(user.must_change);
    navigation.querySelectorAll('button').forEach(button=>{if(button.dataset.board===kind){button.setAttribute('aria-current','page');if(window.matchMedia('(max-width:600px)').matches)button.scrollIntoView({block:'nearest',inline:'nearest'});}else button.removeAttribute('aria-current')});
    if(kind==='resources')renderResources();
    else if(kind==='assignments'||kind==='photos')renderBoard(kind);
  });
  function navigate(kind){if(kind==='home')app.showHome();else if(kind==='calendar')app.showCalendar();else app.showBoard(kind);}
  navigation.querySelectorAll('button').forEach(button=>button.onclick=()=>navigate(button.dataset.board));
  document.querySelectorAll('[data-home-board]').forEach(button=>button.onclick=()=>navigate(button.dataset.homeBoard));

  function renderResources() {
    page.innerHTML=`<div class="eyebrow"><span></span>FIND YOUR NEXT IDEA</div>
      <section class="board-hero"><div><h1>수행평가 자료찾기</h1><p>논문과 책에서 수행평가에 필요한 자료를 찾아봐냥.</p></div></section>
      <div class="resource-grid">
        <section class="resource-card"><a class="resource-link" href="https://www.dbpia.co.kr/" target="_blank" rel="noopener noreferrer"><svg viewBox="0 0 100 110" fill="none" aria-hidden="true"><path d="M22 12h39l18 19v66H22zM61 12v20h18M34 45h32M34 56h32M34 67h18"/><circle cx="64" cy="79" r="12"/><path d="m73 88 13 13"/></svg><strong>논문찾기</strong><span>DBpia에서 논문 찾아보기 ↗</span></a>
          <div class="resource-account"><h2>천안월봉고등학교 계정</h2><p>DBpia 로그인</p>
            <div class="credential-row"><span>ID: <code>cwbhs</code></span><button type="button" data-copy="cwbhs" data-label="아이디">아이디 복사</button></div>
            <div class="credential-row"><span>PW: <code>cwbhs2003</code></span><button type="button" data-copy="cwbhs2003" data-label="비밀번호">비밀번호 복사</button></div>
            <button type="button" class="copy-account" data-copy="ID: cwbhs&#10;PW: cwbhs2003" data-label="계정 정보">계정 정보 전체 복사</button>
            <p class="copy-status" role="status" aria-live="polite"></p>
          </div>
        </section>
        <section class="resource-card"><a class="resource-link" href="https://read365.edunet.net/PureScreen/SchoolSearch?neisCode=N100002464&amp;provCode=N10&amp;schoolName=천안월봉고등학교" target="_blank" rel="noopener noreferrer"><svg viewBox="0 0 100 110" fill="none" aria-hidden="true"><path d="M50 27C37 16 22 17 10 22v65c14-5 27-3 40 7 13-10 26-12 40-7V22c-12-5-27-6-40 5Zm0 0v67M21 36c7-1 13 1 19 4M21 49c7-1 13 1 19 4M60 40c6-3 12-5 19-4M60 53c6-3 12-5 19-4"/></svg><strong>도서찾기</strong><span>독서로에서 우리 학교 도서 찾아보기 ↗</span></a><p class="resource-note">천안월봉고등학교 도서 검색으로 연결돼요.</p></section>
      </div>`;
    page.querySelectorAll('[data-copy]').forEach(button=>button.onclick=async()=>{
      const status=page.querySelector('.copy-status');
      try {
        await copyText(button.dataset.copy);
        status.textContent=button.dataset.label+'를 복사했어요.';
      } catch(error) {
        status.textContent='복사하지 못했어요. 위의 계정 정보를 길게 누르거나 드래그해서 복사해 주세요.';
      }
    });
  }
  async function copyText(value) {
    if(window.isSecureContext&&navigator.clipboard){
      try{await navigator.clipboard.writeText(value);return;}catch(error){}
    }
    const field=document.createElement('textarea'),previous=document.activeElement;
    field.value=value;field.readOnly=true;field.style.cssText='position:fixed;left:-9999px;top:0';document.body.append(field);
    try{field.select();field.setSelectionRange(0,field.value.length);if(!document.execCommand('copy'))throw new Error('copy failed');}
    finally{field.remove();if(previous)previous.focus();}
  }

  function header(kind) {
    const photos=kind==='photos';
    page.innerHTML=`<div class="eyebrow"><span></span>${photos?'OUR LITTLE MEMORIES':'ONE STEP AT A TIME'}</div><section class="board-hero"><div><h1>${photos?'우리 반 학급앨범':'수행평가 게시판'} <span class="board-count" id="board-count"></span></h1><p>${photos?'함께한 순간을 한 장씩 모아봐냥 📷':'제목부터 준비할 내용까지, 함께 챙겨봐냥 📝'}</p></div><button id="create-post" class="primary-button">${photos?'+ 사진 올리기':'+ 글쓰기'}</button></section><p id="board-status" class="board-status" role="status"></p>${photos?'<div class="photo-permission"><span aria-hidden="true">🔒</span><span>친구들은 미리보기를 볼 수 있고,<br>원본 다운로드는 선생님만 할 수 있어요냥.</span></div>':''}<div id="board-items" class="${photos?'photo-grid':'board-list'}" aria-live="polite"></div>`;
    document.getElementById('create-post').onclick=()=>compose(kind);
  }
  async function renderBoard(kind,success='') {
    header(kind);const version=revision;
    const status=document.getElementById('board-status');status.textContent='게시물을 불러오고 있어요냥…';
    try {
      const data=await app.api(kind);
      if(version!==revision||current!==kind)return;
      status.textContent=success;
      const items=data[kind],container=document.getElementById('board-items');
      document.getElementById('board-count').textContent=String(items.length).padStart(2,'0');
      if(!items.length){container.className='';const empty=el('div','empty-state');empty.append(el('span','',kind==='photos'?'📷':'✳'),document.createTextNode(kind==='photos'?'우리 반의 첫 추억을 올려줘냥.':'아직 작성된 수행평가가 없어요냥.'));container.append(empty);return;}
      items.forEach(item=>container.append(kind==='photos'?photoCard(item):assignmentCard(item)));
    }catch(error){if(version===revision)status.textContent=error.message||'게시물을 불러오지 못했어요냥. 다시 눌러 주세요.';}
  }
  function assignmentCard(item) {
    const card=el('article','assignment-card'),meta=el('div','assignment-meta');
    meta.append(el('span','subject-badge',item.subject),el('span','',dateText(item.created_at)+' 작성'));
    card.append(meta,el('h2','',item.title),el('p','assignment-date','시행 날짜 · '+dateText(item.scheduled_date+'T12:00:00')),el('p','assignment-content',item.content),el('p','assignment-author','작성자 · '+authorText(item.author,item.author_name)));
    return card;
  }
  function photoCard(item) {
    const card=el('figure','polaroid'),image=el('img');image.src=`/api/photos/${item.id}/preview`;image.alt=item.caption||'우리 반 사진';image.loading='lazy';image.draggable=false;
    const caption=el('figcaption');caption.append(el('p','photo-caption',item.caption||'우리의 작은 순간'),el('p','photo-meta',authorText(item.author,item.author_name)+' · '+dateText(item.created_at)));
    if(app.getUser()?.role==='teacher'){
      const download=el('a','download-photo','↓ 원본 다운로드');download.href=`/api/photos/${item.id}/download`;download.setAttribute('download','');caption.append(download);
    }
    card.append(image,caption);return card;
  }
  function compose(kind) {
    revision++;const composeVersion=revision,photos=kind==='photos';
    page.innerHTML=`<section class="board-form"><button id="compose-back" class="text-button">← ${photos?'학급앨범':'수행평가'}으로 돌아가기</button><h1>${photos?'오늘을 한 장 남겨봐냥 📷':'수행평가 작성하기 📝'}</h1><p class="account-lead">${photos?'우리 반과 나누고 싶은 순간을 올려줘냥.':'준비할 내용을 친구들에게 알려줘냥.'}</p><form id="post-form" class="account-card">${photos?'<label for="photo-file">사진 선택</label><input id="photo-file" type="file" accept="image/jpeg,image/png,image/webp" required><p class="photo-upload-note">JPG · PNG · WebP / 사진 한 장당 최대 10MB<br>원본은 선생님만 다운로드할 수 있어요냥.</p><figure id="upload-preview" class="polaroid photo-preview" hidden><img id="upload-preview-image" alt="업로드할 사진 미리보기"><figcaption>우리 반의 새로운 추억 🐾</figcaption></figure><label for="photo-caption">사진에 남길 한마디 (선택)</label><textarea id="photo-caption" name="caption" maxlength="140" placeholder="오늘의 추억을 짧게 적어줘냥"></textarea>':'<label for="post-title">제목</label><input id="post-title" name="title" maxlength="100" placeholder="예: 국어 발표 수행평가 안내" required><div class="form-row"><div><label for="post-subject">과목</label><input id="post-subject" name="subject" maxlength="30" placeholder="예: 국어" required></div><div><label for="post-date">시행 날짜</label><input id="post-date" type="date" name="scheduled_date" min="0001-01-01" max="9999-12-31" required></div></div><label for="post-content">내용</label><textarea id="post-content" name="content" maxlength="8000" placeholder="평가 내용, 준비물, 주의할 점 등을 써줘냥" required></textarea>'}<button type="submit" class="primary-button">${photos?'사진 올리기':'게시물 등록하기'}</button><p id="post-message" class="form-message" role="status"></p></form></section>`;
    document.getElementById('compose-back').onclick=()=>{revision++;renderBoard(kind)};
    const form=document.getElementById('post-form'),message=document.getElementById('post-message');
    let imageData=null,selectedFile=null;
    if(photos)document.getElementById('photo-file').onchange=async event=>{
      const file=event.target.files[0];selectedFile=file;imageData=null;message.textContent='';document.getElementById('upload-preview').hidden=true;
      if(!file)return;
      if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10*1024*1024){message.textContent='10MB 이하의 JPG, PNG, WebP 사진을 골라줘냥.';event.target.value='';return;}
      try{
        const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('사진을 읽지 못했어요냥. 다시 골라줘냥.'));reader.readAsDataURL(file)});
        if(selectedFile!==file||revision!==composeVersion||!document.getElementById('upload-preview'))return;
        imageData=data.split(',')[1];document.getElementById('upload-preview-image').src=data;document.getElementById('upload-preview').hidden=false;
      }catch(error){message.textContent=error.message;}
    };
    form.onsubmit=async event=>{
      event.preventDefault();const button=form.querySelector('[type="submit"]');button.disabled=true;message.textContent=photos?'사진을 올리고 있어요냥…':'게시물을 저장하고 있어요냥…';
      const version=revision;
      try{
        const data=Object.fromEntries(new FormData(form));
        if(photos){if(!imageData)throw new Error('사진을 선택하고 미리보기가 뜬 뒤 올려줘냥.');data.image=imageData;}
        await app.api(kind,data);
        if(version!==revision)return;
        revision++;renderBoard(kind,photos?'사진을 올렸어요냥 📷':'수행평가를 등록했어요냥 📝');window.scrollTo(0,0);
      }catch(error){message.textContent=error.message||'저장하지 못했어요냥. 연결을 확인하고 다시 시도해 주세요.';}
      finally{button.disabled=false;}
    };
    window.scrollTo(0,0);
  }
})();
