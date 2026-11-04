'use strict';
const toggle=document.querySelector('.menu-toggle');
const nav=document.querySelector('#nav');
toggle?.addEventListener('click',()=>{const open=toggle.getAttribute('aria-expanded')!=='true';toggle.setAttribute('aria-expanded',String(open));nav.classList.toggle('open',open)});
nav?.addEventListener('click',e=>{if(e.target.closest('a')){toggle.setAttribute('aria-expanded','false');nav.classList.remove('open')}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&nav?.classList.contains('open')){toggle.setAttribute('aria-expanded','false');nav.classList.remove('open');toggle.focus()}});
const filters=[...document.querySelectorAll('[data-filter]')];
const treatments=[...document.querySelectorAll('.treatment')];
function filter(value){let count=0;filters.forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.filter===value)));treatments.forEach(card=>{card.hidden=value!=='all'&&!card.dataset.category.split(' ').includes(value);if(!card.hidden)count++});const status=document.querySelector('#filter-status');if(status)status.textContent=`${count} cuidados disponíveis.`}
filters.forEach(button=>button.addEventListener('click',()=>filter(button.dataset.filter)));
function openHash(){let id;try{id=decodeURIComponent(location.hash.slice(1))}catch{return}if(!id)return;const item=document.getElementById(id);if(!item)return;if(item.classList.contains('treatment')){filter('all');item.open=true;item.scrollIntoView({block:'start',behavior:'auto'})}}
window.addEventListener('hashchange',openHash);window.addEventListener('load',openHash);
