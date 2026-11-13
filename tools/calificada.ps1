$MAIL = 'keylorandrey09@gmail\.com'   # correo de contacto configurado en el widget (como expresión regular)
$u = "https://ejbtgkvlrkecnslpapyd.supabase.co/functions/v1/chat"
$w = "2075b5e2-207f-40ab-a621-0d70620e9ec3"
function Ask($q, $vid, $cid) {
  $b = @{ widget_id=$w; visitor_id=$vid; message=$q }
  if ($cid) { $b.conversation_id = $cid }
  $j = $b | ConvertTo-Json
  Invoke-RestMethod -Method Post -Uri $u -ContentType "application/json; charset=utf-8" -Body ([Text.Encoding]::UTF8.GetBytes($j))
}
function Cortada($a) { ($a -like "Ahora mismo no puedo*") -or ($a -like "Estoy atendiendo*") }
$VOS = '\b(tocá|entrá|abrí|podés|elegí|seleccioná|pegá|escribí|configurá|revisá|encontrás|tenés|ingresá|hacé|andá|buscá|completá|agregá|editá|usá|presioná|activá|pausá|conectá|dirigite)\b'
$TU  = '\b(puedes|tienes|encuentras|selecciona|elige|pulsa|haz|ve a|ve al|toca)\b'
function Grade($t, $a) {
  $fails = @(); $warns = @()
  foreach ($p in $t.must)    { if ($a -notmatch $p) { $fails += "falta: $p" } }
  foreach ($p in $t.mustNot) { if ($a -match $p)    { $fails += "no debe decir: $p" } }
  if ($a -match '\[\[' -or $a -match 'Reply in the same language') { $fails += "se filtró texto interno" }
  if ($a -match 'support-overlay|plan-overlay|welcome-overlay') { $fails += "enlace inútil a una ventana emergente" }
  if ($a -match '\(sidebar\)') { $fails += "se filtró un identificador interno del menú" }
  foreach ($m in [regex]::Matches($a, '[\w.+-]+@[\w-]+(\.[\w-]+)+')) { if ($m.Value -notmatch ('^' + $MAIL + '$')) { $fails += "correo que no es el configurado: $($m.Value)" } }
  if (([regex]::Matches($a, '(?i)\bno (figura|tengo|se detalla|se especifica|especifica)\b')).Count -ge 3) { $fails += "repite que no figura 3 veces o más" }
  if (([regex]::Matches($a, 'No tengo')).Count -ge 2) { $fails += "frase duplicada (No tengo ... No tengo)" }
  if (-not $t.en) {
    $v = $a -match $VOS; $tu = $a -match $TU
    if ($v -and $tu) { $warns += "mezcla vos y tú" } elseif ($tu) { $warns += "usa tú (el predeterminado es vos)" }
  }
  [pscustomobject]@{ Fails=$fails; Warns=$warns }
}
$tests = @(
 @{ q="¿Dónde cambio el tema a oscuro?"; must=@('Apariencia','Oscuro'); mustNot=@('Proyectos') },
 @{ q="¿Cómo creo una automatización?"; must=@('Crear mi primera','Nueva automatizaci','Continuar','Activar automatizaci','11'); mustNot=@() },
 @{ q="¿Dónde elimino mi cuenta?"; must=@('Eliminar cuenta','Configuraci'); mustNot=@() },
 @{ q="¿Dónde cambio de plan?"; must=@('Cambiar de plan','Configuraci'); mustNot=@() },
 @{ q="¿Dónde veo los mensajes enviados?"; must=@('(Automatizaciones|Anal[ií]ticas|Despliegues|no (figura|se muestra|hay|existe))'); mustNot=@('Proyectos','312','Respuestas del mes') },
 @{ q="¿Cómo contacto a soporte?"; must=@($MAIL); mustNot=@('walkychat\.2026@gmail\.com') },
 @{ q="¿Funciona con TikTok?"; must=@('\bno\b'); mustNot=@('^\s*(S[ií])\b') },
 @{ q="¿Hay modo nocturno?"; must=@('Oscuro'); mustNot=@('No tengo (esa )?informaci') },
 @{ q="¿Cómo borro mi cuenta?"; must=@('Eliminar cuenta','Configuraci'); mustNot=@() },
 @{ q="Me pasé del límite de mensajes, ¿qué hago?"; must=@('paus'); mustNot=@() },
 @{ q="¿Dónde veo cuántos mensajes me quedan este mes?"; must=@('Anal[ií]ticas'); mustNot=@('312','Respuestas del mes') },
 @{ q="¿Puedo usar un emoji como palabra clave?"; must=@('(emoji|\uD83D\uDD25)','11'); mustNot=@() },
 @{ q="¿Cuánto tarda en quedar lista una automatización?"; must=@('(2|dos) minutos'); mustNot=@() },
 @{ q="¿Pueden ver mi contraseña de Instagram?"; must=@('(no (se )?(especifica|figura|tengo|indica|aclara|dice)|sin información|no hay información)'); mustNot=@('(no|nunca) (ve|vemos|almacena|guarda|almacenamos|guardamos)[^.]{0,40}contraseña de Instagram','walkychat\.2026') },
 @{ q="¿Cómo agrego otra publicación a la misma automatización?"; must=@('Agregar publicaci','6'); mustNot=@('Proyectos','(Editá|Editar|Abrí|Entrá a|Seleccioná) (la|tu) automatizaci') },
 @{ q="¿Dónde están las notificaciones?"; must=@('Notificaciones'); mustNot=@() },
 @{ q="¿Puedo pausar una automatización?"; must=@('paus'); mustNot=@('^\s*No\b') },
 @{ q="¿Funciona con WhatsApp?"; must=@('\bno\b'); mustNot=@('^\s*(S[ií])\b') },
 @{ q="How do I contact support?"; en=$true; must=@('(support|Soporte)','\b(you|the|open|tap|click|can)\b'); mustNot=@('\b(Podés|abrí|completá|tocá|también|para|desde)\b') },
 @{ q="¿Qué es WalkyChat?"; must=@('Instagram','(comentari|mensaje|DM)'); mustNot=@('No tengo') },
 @{ q="¿Para qué sirve?"; must=@('Instagram','(comentari|mensaje|DM|automatiz)'); mustNot=@('No tengo') },
 @{ q="¿Puedo pedir un reembolso?"; must=@('reembols','14'); mustNot=@('No tengo','no se indica') }
)
$run = Get-Random
Start-Transcript -Path "C:\dev\pruebas\calificada-v22.txt" -Force | Out-Null
$pass = 0; $failed = @(); $warned = @(); $ms = @(); $i = 0; $cut = $false
foreach ($t in $tests) {
  $i++
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $r = Ask $t.q "chk-$run-$i" $null
  $sw.Stop(); $ms += $sw.ElapsedMilliseconds
  $a = [string]$r.answer
  if (Cortada $a) { "CORTADO en la pregunta $i (OpenAI rechazó). Paro."; $cut = $true; break }
  $g = Grade $t $a
  $estado = if ($g.Fails.Count -eq 0) { $pass++; "PASA" } else { $failed += "[$i]"; "FALLA" }
  if ($g.Warns.Count -gt 0) { $warned += "[$i]" }
  "[$i] $estado ($($sw.ElapsedMilliseconds) ms) $($t.q)"
  "     $a"
  foreach ($f in $g.Fails) { "     X $f" }
  foreach ($x in $g.Warns) { "     ! $x" }
  ""
  Start-Sleep -Seconds 3
}
if (-not $cut) {
  $v = "chk-$run-seg"
  $r1 = Ask "¿Cuánto cuesta el plan Pro?" $v $null
  Start-Sleep -Seconds 3
  $r2 = Ask "¿y qué incluye?" $v $r1.conversation_id
  foreach ($s in @(@{n="S1";a=[string]$r1.answer;p='19\.99'}, @{n="S2";a=[string]$r2.answer;p='6\.000'})) {
    if ($s.a -match $s.p) { $pass++; "[$($s.n)] PASA  $($s.a)" } else { $failed += "[$($s.n)]"; "[$($s.n)] FALLA falta: $($s.p)  $($s.a)" }
  }
}
""
"=== RESULTADO: PASAN $pass | FALLAN: $($failed -join ' ') | AVISOS DE TRATAMIENTO: $($warned -join ' ')"
if ($ms.Count) { "=== TIEMPO: promedio $([int](($ms | Measure-Object -Average).Average)) ms | máximo $(($ms | Measure-Object -Maximum).Maximum) ms" }
Stop-Transcript | Out-Null
