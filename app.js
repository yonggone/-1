'use strict';
// 첨부된 2026학년도 2학기 학사일정. 날짜 범위는 양 끝 날짜를 포함합니다.
const events = [
  ['2026-09-02','2026-09-02','전국연합 · 대수능모의평가','exam','전국연합 1·2학년 / 대수능모의평가 3학년'],
  ['2026-09-24','2026-09-25','추석연휴','holiday',''],
  ['2026-09-28','2026-10-02','1회고사','exam','1·2·3학년'],
  ['2026-10-05','2026-10-05','대체공휴일','holiday',''],
  ['2026-10-09','2026-10-09','한글날','holiday',''],
  ['2026-10-20','2026-10-20','전국연합','exam','1·2·3학년'],
  ['2026-10-29','2026-10-29','수업공개의 날','event',''],
  ['2026-11-02','2026-11-05','진로개척통합기행','event','1학년'],
  ['2026-11-04','2026-11-04','진로테마기행','event','2학년'],
  ['2026-11-19','2026-11-19','대학수학능력시험 / 재량휴업','exam',''],
  ['2026-11-20','2026-11-20','재량휴업','holiday',''],
  ['2026-12-08','2026-12-11','2학기 2회고사','exam','1·2학년'],
  ['2026-12-10','2026-12-10','교육과정평가회','event',''],
  ['2026-12-24','2026-12-24','월광제 / 동아리 발표회','event',''],
  ['2026-12-25','2026-12-25','성탄절','holiday',''],
  ['2026-12-31','2026-12-31','졸업식 / 종업식','event',''],
  ['2027-01-01','2027-01-01','신정','holiday',''],
  ['2027-01-21','2027-01-21','신입생 예비소집','event','비대면'],
  ['2027-02-09','2027-02-09','대체공휴일','holiday',''],
  ['2027-02-17','2027-02-18','교육과정 함께 만들기 주간','event',''],
].map(([start,end,title,type,note])=>({start,end,title,type,note}));
const $ = id => document.getElementById(id);
const now = new Date();
let displayed = new Date(now.getFullYear(),now.getMonth(),1);
let selected = null;
const weekdays = ['일','월','화','수','목','금','토'];
const types = {exam:'시험·평가',holiday:'휴일',event:'학교행사'};
const key = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const parse = value => new Date(`${value}T12:00:00`);
const contains = (event,date) => event.start <= date && event.end >= date;
function monthEvents(){
  const first = key(displayed);
  const last = key(new Date(displayed.getFullYear(),displayed.getMonth()+1,0));
  return events.filter(event=>event.start<=last && event.end>=first);
}
function render(){
  const year=displayed.getFullYear(),month=displayed.getMonth();
  $('year-label').textContent=`${year}년`;
  $('month-label').textContent=`${month+1}월`;
  const grid=$('calendar');
  grid.replaceChildren();
  grid.setAttribute('aria-label',`${year}년 ${month+1}월 날짜 선택`);
  const offset=displayed.getDay();
  const count=Math.ceil((offset+new Date(year,month+1,0).getDate())/7)*7;
  for(let i=0;i<count;i++){
    const date=new Date(year,month,i-offset+1), dateKey=key(date);
    const inMonth=date.getMonth()===month;
    const matches=inMonth?events.filter(event=>contains(event,dateKey)):[];
    const button=document.createElement('button');
    button.className=['day',!inMonth?'outside':'',date.getDay()===0?'sunday':'',date.getDay()===6?'saturday':'',dateKey===key(now)?'today':'',selected===dateKey?'selected':''].filter(Boolean).join(' ');
    button.setAttribute('aria-label',`${date.getMonth()+1}월 ${date.getDate()}일 ${weekdays[date.getDay()]}요일${matches.length?' · '+matches.map(e=>e.title).join(', '):' · 일정 없음'}`);
    button.setAttribute('aria-pressed',String(selected===dateKey));
    if(dateKey===key(now))button.setAttribute('aria-current','date');
    const num=document.createElement('span');num.className='day-number';num.textContent=date.getDate();button.append(num);
    if(matches.length){
      const label=document.createElement('span');label.className='day-title';label.textContent=matches[0].title;button.append(label);
      const dots=document.createElement('span');dots.className='day-dots';dots.setAttribute('aria-hidden','true');
      [...new Set(matches.map(e=>e.type))].forEach(type=>{const dot=document.createElement('i');dot.className=`dot ${type}`;dots.append(dot)});button.append(dots);
    }
    button.onclick=()=>{if(!inMonth)displayed=new Date(date.getFullYear(),date.getMonth(),1);selected=selected===dateKey?null:dateKey;render()};
    grid.append(button);
  }
  renderList();
}
function dateLabel(event){
  const start=parse(event.start),end=parse(event.end);
  const format=date=>`${date.getMonth()+1}.${String(date.getDate()).padStart(2,'0')}`;
  return event.start===event.end?`${format(start)} (${weekdays[start.getDay()]})`:`${format(start)}–${format(end)}`;
}
function renderList(){
  const list=$('event-list');list.replaceChildren();
  const matches=monthEvents().filter(event=>!selected||contains(event,selected));
  $('schedule-title').firstChild.textContent=selected?`${parse(selected).getMonth()+1}월 ${parse(selected).getDate()}일 일정 `:'이번 달 일정 ';
  $('event-count').textContent=matches.length.toString().padStart(2,'0');
  $('show-all').hidden=!selected;$('schedule-note').hidden=Boolean(selected);
  if(!matches.length){
    const empty=document.createElement('div');empty.className='empty-state';
    const mark=document.createElement('span');mark.textContent='✳';empty.append(mark);
    empty.append(document.createTextNode(selected?'이날은 등록된 학사일정이 없어요.':'이번 달은 등록된 학사일정이 없어요.'));
    list.append(empty);return;
  }
  matches.forEach(event=>{
    const visibleStart=event.start<key(displayed)?key(displayed):event.start;
    const date=parse(visibleStart);
    const row=document.createElement('button');row.className='event-row';
    const dateBox=document.createElement('span');dateBox.className='event-date';
    const number=document.createElement('strong');number.textContent=String(date.getDate()).padStart(2,'0');
    const day=document.createElement('small');day.textContent=`${weekdays[date.getDay()]}요일`;dateBox.append(number,day);
    const divider=document.createElement('span');divider.className=`event-divider ${event.type}`;
    const content=document.createElement('span');content.className='event-content';
    const title=document.createElement('strong');title.textContent=event.title;
    const detail=document.createElement('small');detail.textContent=[dateLabel(event),event.note].filter(Boolean).join(' · ');content.append(title,detail);
    const badge=document.createElement('span');badge.className='event-badge';badge.textContent=types[event.type];
    row.append(dateBox,divider,content,badge);row.onclick=()=>{selected=visibleStart;render();const index=new Date(parse(visibleStart).getFullYear(),parse(visibleStart).getMonth(),1).getDay()+parse(visibleStart).getDate()-1;$('calendar').children[index]?.focus({preventScroll:true})};list.append(row);
  });
}
function moveMonth(delta){displayed=new Date(displayed.getFullYear(),displayed.getMonth()+delta,1);selected=null;render()}
$('prev').onclick=()=>moveMonth(-1);
$('next').onclick=()=>moveMonth(1);
$('today').onclick=()=>{displayed=new Date(now.getFullYear(),now.getMonth(),1);selected=key(now);render()};
$('show-all').onclick=()=>{selected=null;render()};
render();
