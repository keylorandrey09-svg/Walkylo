// delete-account (v2) - Fase 1-h.
// Borra primero los archivos de Storage del usuario (vía API) y recién
// después al usuario. Desplegar con verify_jwt = true.
// Si falla el borrado de archivos, NO borra la cuenta y devuelve error:
// así nunca queda "cuenta borrada + archivos huérfanos".
import { createClient } from 'jsr:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// TODO: agregar 'chat-images' acá cuando el bucket exista (Fase 3), para que
// el borrado de cuenta también elimine las imágenes de chat del usuario.
const BUCKETS = ['avatars', 'support']

// Borra todo lo que haya bajo <bucket>/<uid>/ (pagina de a 100)
async function purgeUserFolder(admin: ReturnType<typeof createClient>, bucket: string, uid: string) {
  let total = 0
  while (true) {
    const { data, error } = await admin.storage.from(bucket).list(uid, { limit: 100, offset: 0 })
    if (error) throw new Error(`list ${bucket}: ${error.message}`)
    const files = (data ?? []).filter((f) => f.id) // ignora "carpetas" (id null)
    if (files.length === 0) break
    const paths = files.map((f) => `${uid}/${f.name}`)
    const { error: rmErr } = await admin.storage.from(bucket).remove(paths)
    if (rmErr) throw new Error(`remove ${bucket}: ${rmErr.message}`)
    total += paths.length
    if (files.length < 100) break
  }
  return total
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

  try {
    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.replace('Bearer ', '').trim()
    if (!token) return json({ error: 'no auth' }, 401)

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    const { data: userData, error: userErr } = await admin.auth.getUser(token)
    if (userErr || !userData?.user) return json({ error: 'invalid token' }, 401)
    const uid = userData.user.id

    // 1) Archivos de Storage (si algo falla, se aborta antes de borrar la cuenta)
    const removed: Record<string, number> = {}
    for (const b of BUCKETS) removed[b] = await purgeUserFolder(admin, b, uid)

    // 2) Usuario (las tablas se limpian por ON DELETE CASCADE)
    const { error: delErr } = await admin.auth.admin.deleteUser(uid)
    if (delErr) {
      console.error('delete-account deleteUser failed:', delErr.message)
      return json({ error: 'No se pudo eliminar la cuenta. Intentá de nuevo.' }, 400)
    }

    return json({ ok: true, files_removed: removed })
  } catch (e) {
    // El detalle va al log (privado); al cliente solo un mensaje genérico.
    console.error('delete-account failed:', e)
    return json({ error: 'No se pudo eliminar la cuenta. Intentá de nuevo.' }, 500)
  }
})
