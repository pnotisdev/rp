import { useEffect, useState } from 'react'
import { OPENMAYHEM_PROXY } from '@/lib/api/openMayhem'

type Offer = { slug: string; credit_usd: string; ends_at: string | null }
const LINK = 'text-accent hover:underline'

/** Account creation and credit claims stay on OpenMayhem; RP Suite only receives an API key. */
export function OpenMayhemSetup() {
  const [offer, setOffer] = useState<Offer | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    fetch(`${OPENMAYHEM_PROXY}/campaign`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) return
        const data = await res.json() as { campaign?: Offer }
        const campaign = data.campaign
        if (campaign && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(campaign.slug)
          && Number(campaign.credit_usd) > 0
          && (!campaign.ends_at || Date.parse(campaign.ends_at) > Date.now())) setOffer(campaign)
      })
      .catch(() => {})
    return () => controller.abort()
  }, [])

  return (
    <div className="my-3 rounded-xl bg-bg-elevated p-4 text-xs text-text-muted">
      <p className="mb-2 font-medium text-text">Use OpenMayhem in RP Suite</p>
      <ol className="list-decimal space-y-2 pl-4">
        <li><a className={LINK} href="https://openmayhem.ai/signup" target="_blank" rel="noopener noreferrer">Create an OpenMayhem account</a>.</li>
        <li>
          {offer ? <>
            <a className={LINK} href={`https://openmayhem.ai/offers/${offer.slug}`} target="_blank" rel="noopener noreferrer">
              Claim ${Number(offer.credit_usd).toFixed(2)} in free credits
            </a>
            {' '}while the offer is available. Email and card verification are required; eligibility is checked by OpenMayhem.
          </> : <>
            <a className={LINK} href="https://openmayhem.ai/dashboard/credits" target="_blank" rel="noopener noreferrer">Check credits and current offers</a> on OpenMayhem.
          </>}
        </li>
        <li><a className={LINK} href="https://openmayhem.ai/dashboard/keys" target="_blank" rel="noopener noreferrer">Create an API key</a> with Chat permission, paste it below, then choose a model.</li>
      </ol>
      <p className="mt-3">Replies and background scoring use your OpenMayhem credits. Chats stay saved here; prompts and your key pass through your RP Suite server to OpenMayhem for inference.</p>
      <p className="mt-2">Thinking is disabled when the model supports it so short replies and scoring calls have room to answer. Stopping a reply may still incur the provider’s generation cost.</p>
      <p className="mt-2"><a className={LINK} href="https://openmayhem.ai/models" target="_blank" rel="noopener noreferrer">Compare model prices and availability</a></p>
    </div>
  )
}
