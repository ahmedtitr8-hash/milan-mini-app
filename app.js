const SUPABASE_URL = "https://ckriyvqnrzravknajckl.supabase.co";
const SUPABASE_KEY = "ضع_المفتاح_هنا";

const supabase = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_KEY
);

const pages = document.querySelectorAll(".page");

function showPage(id){

pages.forEach(p=>p.style.display="none");

document.getElementById(id).style.display="block";

}

setTimeout(()=>{

document.getElementById("loading").style.display="none";

document.getElementById("app").style.display="block";

},1000);

async function loadNextMatch(){

const {data,error}=await supabase
.from("matches")
.select("*")
.order("match_date",{ascending:true})
.limit(1);

if(error){

console.log(error);

return;

}

const box=document.getElementById("nextMatch");

if(data.length===0){

box.innerHTML=`
<div class="card">
لا توجد مباراة قادمة
</div>
`;

return;

}

const m=data[0];

box.innerHTML=`

<div class="card">

<img src="${m.image}">

<h3>${m.home} 🆚 ${m.away}</h3>

<p>${m.match_date}</p>

<button class="btn"
onclick="showPage('matches')">

كل المباريات

</button>

</div>

`;

}

async function loadMatches(){

const {data,error}=await supabase
.from("matches")
.select("*")
.order("match_date",{ascending:false});

if(error)return;

const list=document.getElementById("matchesList");

list.innerHTML="";

data.forEach(match=>{

list.innerHTML+=`

<div class="card">

<img src="${match.image}">

<h3>

${match.home}

🆚

${match.away}

</h3>

<p>

${match.match_date}

</p>

<button
class="btn"

onclick="playVideo('${match.full_match}','${match.home} vs ${match.away}')">

المباراة الكاملة

</button>

<button
class="btn"

onclick="playVideo('${match.highlight}','ملخص المباراة')">

الملخص

</button>

</div>

`;

});

}

async function loadVideos(){

const {data,error}=await supabase
.from("videos")
.select("*")
.order("created_at",{ascending:false});

if(error)return;

const latest=document.getElementById("latestVideos");

const videos=document.getElementById("videosList");

latest.innerHTML="";

videos.innerHTML="";

data.forEach(video=>{

const html=`

<div class="card">

<img src="${video.image}">

<h3>${video.title}</h3>

<button

class="btn"

onclick="playVideo('${video.url}','${video.title}')">

▶ تشغيل

</button>

</div>

`;

latest.innerHTML+=html;

videos.innerHTML+=html;

});

}

loadNextMatch();

loadMatches();

loadVideos();
let hls = null;

function playVideo(url, title) {

document.getElementById("app").style.display = "none";
document.getElementById("playerPage").style.display = "block";

document.getElementById("videoTitle").innerText = title;

const video = document.getElementById("player");

if(hls){
hls.destroy();
}

if(Hls.isSupported()){

hls = new Hls({

enableWorker:true,

lowLatencyMode:true,

backBufferLength:90

});

hls.loadSource(url);

hls.attachMedia(video);

}else{

video.src=url;

}

const last = localStorage.getItem(url);

video.onloadedmetadata=()=>{

if(last){

video.currentTime=parseFloat(last);

}

video.play();

};

video.ontimeupdate=()=>{

localStorage.setItem(url,video.currentTime);

};

}

function closePlayer(){

const video=document.getElementById("player");

video.pause();

if(hls){

hls.destroy();

}

video.src="";

document.getElementById("playerPage").style.display="none";

document.getElementById("app").style.display="block";

}

document.addEventListener("keydown",(e)=>{

if(e.key==="Escape"){

closePlayer();

}

});

const tg=window.Telegram.WebApp;

tg.ready();

tg.expand();

tg.setHeaderColor("#111111");

tg.setBackgroundColor("#0b0b0b");

videoGesture();

function videoGesture(){

const video=document.getElementById("player");

let startX=0;

video.addEventListener("touchstart",(e)=>{

startX=e.touches[0].clientX;

});

video.addEventListener("touchend",(e)=>{

const endX=e.changedTouches[0].clientX;

if(endX-startX>80){

video.currentTime-=10;

}

if(startX-endX>80){

video.currentTime+=10;

}

});

video.addEventListener("dblclick",()=>{

if(document.fullscreenElement){

document.exitFullscreen();

}else{

video.requestFullscreen();

}

});

}

async function refreshData(){

loadNextMatch();

loadMatches();

loadVideos();

}

setInterval(refreshData,60000);
