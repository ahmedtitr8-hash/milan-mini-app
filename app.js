async function loadMatches(){

const {data,error}=await supabase
.from("matches")
.select("*")
.order("match_date",{ascending:true})
.limit(1);

if(error)return;

const box=document.getElementById("matchCard");

if(data.length===0){

box.innerHTML="<div class='card'>لا توجد مباريات</div>";

return;

}

const match=data[0];

box.innerHTML=`
<div class="card">
<h3>${match.home} VS ${match.away}</h3>
<p>${match.match_date}</p>
</div>
`;

}

loadMatches();
