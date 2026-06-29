const SUPABASE_URL="https://ckriyvqnrzravknajckl.supabase.co";
const SUPABASE_KEY="ضع_المفتاح_هنا";

const supabase=window.supabase.createClient(
SUPABASE_URL,
SUPABASE_KEY
);

let editingMatch=null;
let editingVideo=null;

async function addMatch(){

const home=document.getElementById("home").value;
const away=document.getElementById("away").value;
const date=document.getElementById("date").value;
const image=document.getElementById("image").value;
const full=document.getElementById("full").value;
const highlight=document.getElementById("highlight").value;

if(editingMatch){

const {error}=await supabase
.from("matches")
.update({

home,
away,
match_date:date,
image,
full_match:full,
highlight

})
.eq("id",editingMatch);

if(error){

alert(error.message);
return;

}

editingMatch=null;

document.getElementById("matchBtn").innerText="حفظ المباراة";

alert("تم تعديل المباراة");

loadMatches();

return;

}

const {error}=await supabase
.from("matches")
.insert([{

home,
away,
match_date:date,
image,
full_match:full,
highlight

}]);

if(error){

alert(error.message);
return;

}

alert("تمت إضافة المباراة");

loadMatches();

}

async function addVideo(){

const title=document.getElementById("title").value;
const image=document.getElementById("thumb").value;
const url=document.getElementById("url").value;

if(editingVideo){

const {error}=await supabase
.from("videos")
.update({

title,
image,
url

})
.eq("id",editingVideo);

if(error){

alert(error.message);
return;

}

editingVideo=null;

document.getElementById("videoBtn").innerText="رفع الفيديو";

alert("تم تعديل الفيديو");

loadVideos();

return;

}

const {error}=await supabase
.from("videos")
.insert([{

title,
image,
url

}]);

if(error){

alert(error.message);
return;

}

alert("تمت إضافة الفيديو");

loadVideos();

}

async function loadMatches(){

const {data}=await supabase
.from("matches")
.select("*")
.order("match_date",{ascending:false});

const box=document.getElementById("adminList");

box.innerHTML="<h2>المباريات</h2>";

data.forEach(match=>{

box.innerHTML+=`

<div class="card">

<b>${match.home} 🆚 ${match.away}</b>

<br><br>

<button class="btn"
onclick="editMatch('${match.id}')">

✏️ تعديل

</button>

<button class="btn"
onclick="deleteMatch('${match.id}')">

🗑 حذف

</button>

</div>

`;

});}

async function loadVideos(){

const {data}=await supabase
.from("videos")
.select("*")
.order("created_at",{ascending:false});

const box=document.getElementById("adminList");

box.innerHTML+="<h2>الفيديوهات</h2>";

data.forEach(video=>{

box.innerHTML+=`

<div class="card">

<b>${video.title}</b>

<br><br>

<button
class="btn"
onclick="editVideo('${video.id}')">

✏️ تعديل

</button>

<button
class="btn"
onclick="deleteVideo('${video.id}')">

🗑 حذف

</button>

</div>

`;

});

}

async function editMatch(id){

const {data,error}=await supabase
.from("matches")
.select("*")
.eq("id",id)
.single();

if(error)return;

editingMatch=id;

document.getElementById("home").value=data.home;
document.getElementById("away").value=data.away;
document.getElementById("date").value=data.match_date;
document.getElementById("image").value=data.image;
document.getElementById("full").value=data.full_match;
document.getElementById("highlight").value=data.highlight;

document.getElementById("matchBtn").innerText="حفظ التعديل";

window.scrollTo({

top:0,
behavior:"smooth"

});

}

async function editVideo(id){

const {data,error}=await supabase
.from("videos")
.select("*")
.eq("id",id)
.single();

if(error)return;

editingVideo=id;

document.getElementById("title").value=data.title;
document.getElementById("thumb").value=data.image;
document.getElementById("url").value=data.url;

document.getElementById("videoBtn").innerText="حفظ التعديل";

window.scrollTo({

top:0,
behavior:"smooth"

});

}

async function deleteMatch(id){

if(!confirm("حذف المباراة؟")) return;

await supabase
.from("matches")
.delete()
.eq("id",id);

loadMatches();

loadVideos();

}

async function deleteVideo(id){

if(!confirm("حذف الفيديو؟")) return;

await supabase
.from("videos")
.delete()
.eq("id",id);

loadMatches();

loadVideos();

}loadMatches();
loadVideos();

function clearMatchForm(){

editingMatch=null;

document.getElementById("home").value="";
document.getElementById("away").value="";
document.getElementById("date").value="";
document.getElementById("image").value="";
document.getElementById("full").value="";
document.getElementById("highlight").value="";

const btn=document.getElementById("matchBtn");

if(btn){

btn.innerText="حفظ المباراة";

btn.onclick=addMatch;

}

}

function clearVideoForm(){

editingVideo=null;

document.getElementById("title").value="";
document.getElementById("thumb").value="";
document.getElementById("url").value="";

const btn=document.getElementById("videoBtn");

if(btn){

btn.innerText="رفع الفيديو";

btn.onclick=addVideo;

}

}

setInterval(()=>{

loadMatches();

loadVideos();

},30000);

document.addEventListener("DOMContentLoaded",()=>{

const matchBtn=document.getElementById("matchBtn");

if(matchBtn){

matchBtn.onclick=addMatch;

}

const videoBtn=document.getElementById("videoBtn");

if(videoBtn){

videoBtn.onclick=addVideo;

}

});async function uploadImage(file){

const fileName=Date.now()+"_"+file.name;

const {error}=await supabase.storage
.from("images")
.upload(fileName,file);

if(error){

alert(error.message);

return null;

}

const {data}=supabase.storage
.from("images")
.getPublicUrl(fileName);

return data.publicUrl;

}

async function uploadVideo(file){

const fileName=Date.now()+"_"+file.name;

const {error}=await supabase.storage
.from("videos")
.upload(fileName,file);

if(error){

alert(error.message);

return null;

}

const {data}=supabase.storage
.from("videos")
.getPublicUrl(fileName);

return data.publicUrl;

}

async function chooseImage(inputId,targetId){

const file=document.getElementById(inputId).files[0];

if(!file)return;

const url=await uploadImage(file);

if(url){

document.getElementById(targetId).value=url;

alert("تم رفع الصورة");

}

}

async function chooseVideo(inputId,targetId){

const file=document.getElementById(inputId).files[0];

if(!file)return;

const url=await uploadVideo(file);

if(url){

document.getElementById(targetId).value=url;

alert("تم رفع الفيديو");

}

                        }async function uploadImage(file){

const fileName=Date.now()+"_"+file.name;

const {error}=await supabase.storage
.from("images")
.upload(fileName,file);

if(error){

alert(error.message);

return null;

}

const {data}=supabase.storage
.from("images")
.getPublicUrl(fileName);

return data.publicUrl;

}

async function uploadVideo(file){

const fileName=Date.now()+"_"+file.name;

const {error}=await supabase.storage
.from("videos")
.upload(fileName,file);

if(error){

alert(error.message);

return null;

}

const {data}=supabase.storage
.from("videos")
.getPublicUrl(fileName);

return data.publicUrl;

}

async function chooseImage(inputId,targetId){

const file=document.getElementById(inputId).files[0];

if(!file)return;

const url=await uploadImage(file);

if(url){

document.getElementById(targetId).value=url;

alert("تم رفع الصورة");

}

}

async function chooseVideo(inputId,targetId){

const file=document.getElementById(inputId).files[0];

if(!file)return;

const url=await uploadVideo(file);

if(url){

document.getElementById(targetId).value=url;

alert("تم رفع الفيديو");

}

}
