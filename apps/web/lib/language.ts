export const decisionateLanguageStorageKey =
  "decisionate:language"
export const decisionateLanguageChangedEvent =
  "decisionate:language-changed"

export type DecisionateLanguage =
  | "en"
  | "fr"

export type DecisionateLanguageChange = {
  language: DecisionateLanguage
}

const languageLocales: Record<
  DecisionateLanguage,
  string
> = {
  en: "en-CA",
  fr: "fr-CA",
}

const translations = {
  en: {
    switchToEnglish: "Switch to English",
    switchToFrench: "Passer au français",
    workspace: "Workspace",
    dashboard: "Dashboard",
    dashboards: "Dashboards",
    decisions: "Decisions",
    actionNeeded: "Action Needed",
    workspaceAccess: "Workspace Access",
    analysis: "Analysis",
    insights: "Insights",
    forecasts: "Forecasts",
    reports: "Reports",
    alerts: "Alerts",
    relationships: "Relationships",
    data: "Data",
    datasets: "Datasets",
    entityMatching: "Entity Matching",
    connections: "Connections",
    manage: "Manage",
    settings: "Settings",
    billing: "Billing",
    support: "Support",
    helpSupport: "Help & Support",
    account: "Account",
    businessWorkspace: "Business workspace",
    portal: "portal",
    dashboardNavigation: "Dashboard navigation",
    closeNavigation: "Close dashboard navigation",
    openNavigation: "Open dashboard navigation",
    closeNavigationShort: "Close navigation",
    openNavigationShort: "Open navigation",
    reload: "Reload",
    dismiss: "Dismiss",
  },
  fr: {
    switchToEnglish: "Passer à l'anglais",
    switchToFrench: "Passer au français",
    workspace: "Espace de travail",
    dashboard: "Tableau de bord",
    dashboards: "Tableaux de bord",
    decisions: "Décisions",
    actionNeeded: "Action requise",
    workspaceAccess: "Accès à l'espace de travail",
    analysis: "Analyse",
    insights: "Analyses",
    forecasts: "Prévisions",
    reports: "Rapports",
    alerts: "Alertes",
    relationships: "Relations",
    data: "Données",
    datasets: "Jeux de données",
    entityMatching: "Appariement d'entités",
    connections: "Connexions",
    manage: "Gestion",
    settings: "Paramètres",
    billing: "Facturation",
    support: "Assistance",
    helpSupport: "Aide et assistance",
    account: "Compte",
    businessWorkspace: "Espace de travail professionnel",
    portal: "portail",
    dashboardNavigation: "Navigation du tableau de bord",
    closeNavigation: "Fermer la navigation du tableau de bord",
    openNavigation: "Ouvrir la navigation du tableau de bord",
    closeNavigationShort: "Fermer la navigation",
    openNavigationShort: "Ouvrir la navigation",
    reload: "Recharger",
    dismiss: "Fermer",
  },
} as const

const frenchLandingTranslations: Record<string, string> = {
  "Decisions from Data.": "Des décisions fondées sur les données.",
  "Decisionate home": "Accueil de Decisionate",
  Product: "Produit",
  Solutions: "Solutions",
  "Industry Dashboards": "Tableaux de bord sectoriels",
  Pricing: "Tarifs",
  Resources: "Ressources",
  Company: "Entreprise",
  "Main navigation": "Navigation principale",
  "Mobile navigation": "Navigation mobile",
  "Open Live Demo": "Ouvrir la démo en direct",
  "Close navigation": "Fermer la navigation",
  "Open navigation": "Ouvrir la navigation",
  "Decision intelligence for growing businesses & agencies":
    "L'intelligence décisionnelle pour les entreprises et agences en croissance",
  "Turn your business data into better decisions.":
    "Transformez vos données d'entreprise en meilleures décisions.",
  "Decisionate is a decision intelligence platform powered by your business data. Connect your data, generate AI-powered insights and recommendations, make better decisions and measure outcomes.":
    "Decisionate est une plateforme d'intelligence décisionnelle alimentée par vos données d'entreprise. Connectez vos données, générez des analyses et recommandations assistées par l'IA, prenez de meilleures décisions et mesurez les résultats.",
  "Business intelligence dashboards give your team a clear view of performance before the next decision.":
    "Les tableaux de bord de veille stratégique donnent à votre équipe une vue claire de la performance avant la prochaine décision.",
  "Open the Decisionate product walkthrough":
    "Ouvrir la présentation du produit Decisionate",
  "Watch Demo": "Voir la démo",
  "Start with your existing data": "Commencez avec vos données existantes",
  "Built for growing teams": "Conçu pour les équipes en croissance",
  "Product demo": "Démo du produit",
  "From signal to learning": "Du signal à l'apprentissage",
  "Close product demo": "Fermer la démo du produit",
  "Built for growing businesses, agencies and agency client teams":
    "Conçu pour les entreprises, agences et équipes clientes d'agences en croissance",
  "Owner-led teams": "Équipes dirigées par leurs propriétaires",
  "Agency workspaces": "Espaces de travail d'agence",
  "Client portals": "Portails clients",
  "Evidence-led decisions": "Décisions fondées sur les données probantes",
  "The product workflow": "Le flux de travail du produit",
  "The path from business data to better judgment":
    "Le chemin des données d'entreprise vers un meilleur jugement",
  "Decisionate follows the same order your team does: understand the situation, choose an action, see what happened and carry the lesson forward.":
    "Decisionate suit le même ordre que votre équipe : comprendre la situation, choisir une action, voir ce qui s'est passé et faire progresser l'apprentissage.",
  "Data inputs": "Données d'entrée",
  Evidence: "Données probantes",
  Action: "Action",
  Learning: "Apprentissage",
  "Industry dashboards": "Tableaux de bord sectoriels",
  "Start with a view that understands your business":
    "Commencez avec une vue qui comprend votre entreprise",
  "Use a general view or choose an industry dashboard with measures, comparisons and decision questions shaped for the work you do.":
    "Utilisez une vue générale ou choisissez un tableau de bord sectoriel avec des mesures, comparaisons et questions décisionnelles adaptées à votre activité.",
  "Open live demo": "Ouvrir la démo en direct",
  dashboard: "tableau de bord",
  "Core capabilities": "Capacités essentielles",
  "Everything needed to move from signal to action":
    "Tout ce qu'il faut pour passer du signal à l'action",
  "Use the parts you need today, then connect them into a repeatable decision practice as your business grows.":
    "Utilisez les éléments dont vous avez besoin aujourd'hui, puis reliez-les dans une pratique décisionnelle reproductible à mesure que votre entreprise grandit.",
  "Connect Your Data": "Connectez vos données",
  "Start with the files and systems your business already uses.":
    "Commencez avec les fichiers et systèmes que votre entreprise utilise déjà.",
  "Business Intelligence Dashboards": "Tableaux de bord de veille stratégique",
  "Track KPIs, compare periods and explore business performance in clear, practical dashboards.":
    "Suivez les indicateurs clés, comparez les périodes et explorez la performance de l'entreprise dans des tableaux de bord clairs et pratiques.",
  "Decision Intelligence": "Intelligence décisionnelle",
  "Move from meaningful signals to evidence-backed recommendations and accountable choices.":
    "Passez de signaux pertinents à des recommandations fondées sur les données probantes et à des choix imputables.",
  Forecasting: "Prévisions",
  "Use trends and projections to prepare before a result becomes a surprise.":
    "Utilisez les tendances et projections pour vous préparer avant qu'un résultat ne devienne une surprise.",
  "AI Recommendations": "Recommandations IA",
  "Get an evidence-based next step with context you can review.":
    "Obtenez une prochaine étape fondée sur les données probantes, avec un contexte que vous pouvez examiner.",
  "Decision Tracking": "Suivi des décisions",
  "Give every important choice an owner, outcome and review point.":
    "Donnez à chaque choix important un responsable, un résultat attendu et un point de révision.",
  "Outcome Measurement": "Mesure des résultats",
  "Turn what happened into organizational knowledge for the next decision.":
    "Transformez ce qui s'est passé en connaissances organisationnelles pour la prochaine décision.",
  "The AI decision engine": "Le moteur de décision IA",
  "Charts are the beginning, not the destination.":
    "Les graphiques sont le début, pas la destination.",
  "Decisionate helps teams move from a business signal to a recommendation, then keeps the outcome and lesson attached to the original decision.":
    "Decisionate aide les équipes à passer d'un signal d'entreprise à une recommandation, puis rattache le résultat et l'apprentissage à la décision d'origine.",
  "Human judgment, strengthened by evidence":
    "Le jugement humain, renforcé par les données probantes",
  "Business data": "Données d'entreprise",
  "AI analysis": "Analyse IA",
  Recommendation: "Recommandation",
  Decision: "Décision",
  "Decision lifecycle": "Cycle de vie d'une décision",
  "Keep the decision connected to the result":
    "Gardez la décision liée au résultat",
  "Traditional BI tools often stop at the chart. Decisionate continues through the action, review, outcome and lesson learned.":
    "Les outils de veille stratégique traditionnels s'arrêtent souvent au graphique. Decisionate poursuit avec l'action, la révision, le résultat et l'apprentissage.",
  "A signal worth considering": "Un signal qui mérite attention",
  "A choice with an owner": "Un choix avec un responsable",
  "The work that makes it real": "Le travail qui le rend concret",
  "A moment to look again": "Un moment pour réexaminer",
  Outcome: "Résultat",
  "What actually happened": "Ce qui s'est réellement passé",
  "Lesson learned": "Apprentissage retenu",
  "What to repeat or avoid": "Ce qu'il faut répéter ou éviter",
  Integrations: "Intégrations",
  "Start with the data you already have":
    "Commencez avec les données que vous avez déjà",
  "Connect quickly with available sources today, then expand into the systems your operating model depends on.":
    "Connectez-vous rapidement aux sources disponibles aujourd'hui, puis élargissez vers les systèmes dont dépend votre modèle opérationnel.",
  Available: "Disponible",
  Upcoming: "À venir",
  "Why Decisionate": "Pourquoi Decisionate",
  "A better operating habit, not another reporting tab":
    "Une meilleure habitude de gestion, pas un autre onglet de rapports",
  "Give growing teams a shared way to turn business evidence into action and organizational learning.":
    "Donnez aux équipes en croissance une méthode commune pour transformer les données probantes en action et en apprentissage organisationnel.",
  "Save time": "Gagnez du temps",
  "Move from raw data to a useful next step without rebuilding analysis every week.":
    "Passez des données brutes à une prochaine étape utile sans refaire l'analyse chaque semaine.",
  "Reduce risk": "Réduisez les risques",
  "Make assumptions, ownership, expected outcomes and review dates visible.":
    "Rendez visibles les hypothèses, les responsabilités, les résultats attendus et les dates de révision.",
  "Improve decisions": "Améliorez les décisions",
  "Give teams a shared evidence trail for the choices that matter most.":
    "Donnez aux équipes une piste commune de données probantes pour les choix les plus importants.",
  "Increase revenue": "Augmentez les revenus",
  "Find the commercial signals that deserve action before the window closes.":
    "Trouvez les signaux commerciaux qui méritent une action avant que l'occasion ne se referme.",
  "Track results": "Suivez les résultats",
  "Compare what you expected with what actually happened after the decision.":
    "Comparez ce que vous attendiez à ce qui s'est réellement passé après la décision.",
  "Build knowledge": "Développez les connaissances",
  "Preserve lessons so the organization gets wiser, not just busier.":
    "Conservez les apprentissages pour que l'organisation devienne plus avisée, pas seulement plus occupée.",
  "Plans for businesses and agencies": "Plans pour entreprises et agences",
  "Choose the way you manage decisions": "Choisissez votre mode de gestion des décisions",
  "Start with full access for 30 days. Choose Professional for one business workspace, or scale with agency plans based on client workspaces rather than employee seats.":
    "Commencez avec un accès complet pendant 30 jours. Choisissez Professionnel pour un espace de travail d'entreprise, ou évoluez avec des plans d'agence basés sur les espaces clients plutôt que sur les sièges employés.",
  "CAD / month": "CAD / mois",
  "$0 CAD/year": "$0 CAD/an",
  "$790 CAD/year": "$790 CAD/an",
  "$1,990 CAD/year": "$1 990 CAD/an",
  "Annual billing": "Facturation annuelle",
  "Most popular": "Le plus populaire",
  "Explore Live Demo": "Explorer la démo en direct",
  "1 workspace": "1 espace de travail",
  "1,000 AI credits/month; annual allocation: N/A": "1 000 crédits IA/mois ; allocation annuelle : sans objet",
  "Full access for 30 days": "Accès complet pendant 30 jours",
  "1 workspace during the trial": "1 espace de travail pendant l'essai",
  "Unlimited datasets": "Jeux de données illimités",
  "All industry dashboards": "Tous les tableaux de bord sectoriels",
  "AI-powered recommendations": "Recommandations alimentées par l'IA",
  "Decision management": "Gestion des décisions",
  "Outcome tracking": "Suivi des résultats",
  "White-label client portal": "Portail client en marque blanche",
  "Agency branding": "Image de marque de l'agence",
  "10 client workspaces during the trial": "10 espaces clients pendant l'essai",
  "Need more capacity? Add client workspaces for $20 CAD/month each or $200 CAD/year each. Each additional client workspace includes 2,500 AI credits/month or 30,000/year.":
    "Besoin de plus de capacité ? Ajoutez des espaces clients pour 20 CAD/mois ou 200 CAD/an chacun. Chaque espace client supplémentaire comprend 2 500 crédits IA/mois ou 30 000/an.",
  "Additional AI credit packs are available when your usage grows.":
    "Des forfaits de crédits IA supplémentaires sont disponibles lorsque votre utilisation augmente.",
  "Decisionate pricing and AI credit allocation": "Tarifs Decisionate et allocation de crédits IA",
  Plan: "Plan",
  "Price (CAD)": "Prix (CAD)",
  "Annual (CAD)": "Annuel (CAD)",
  "Client workspaces": "Espaces clients",
  "AI credits (monthly / annual)": "Crédits IA (mensuels / annuels)",
  "Additional client workspace": "Espace client supplémentaire",
  Questions: "Questions",
  "Frequently asked": "Questions fréquentes",
  "A few useful answers before you start.": "Quelques réponses utiles avant de commencer.",
  "Open the live demo": "Ouvrir la démo en direct",
  "Ready to make better decisions?": "Prêt à prendre de meilleures décisions ?",
  "Start with your data, create your first decision and build the habit of learning from what happens next.":
    "Commencez avec vos données, créez votre première décision et développez l'habitude d'apprendre de ce qui se passe ensuite.",
  "Workflow": "Flux de travail",
  "Live demo": "Démo en direct",
  Support: "Assistance",
  Security: "Sécurité",
  Privacy: "Confidentialité",
  Terms: "Conditions",
  "Decision intelligence for teams that want to act on evidence and learn from the choices they make.":
    "L'intelligence décisionnelle pour les équipes qui veulent agir sur les données probantes et apprendre de leurs choix.",
  "Built for clearer decisions and accountable follow-through.":
    "Conçu pour des décisions plus claires et un suivi imputable.",
  "All rights reserved.": "Tous droits réservés.",
  Decisionate: "Decisionate",
  Dashboard: "Tableau de bord",
  "Live decision signal": "Signal décisionnel en direct",
  "Decision intelligence": "Intelligence décisionnelle",
  "General Business Overview": "Vue d'ensemble générale",
  "Evidence for your next operating decision.":
    "Des données probantes pour votre prochaine décision opérationnelle.",
  Show: "Afficher",
  business: "entreprise",
  marketing: "marketing",
  preview: "aperçu",
  Revenue: "Revenus",
  Decisions: "Décisions",
  "outcomes captured": "résultats enregistrés",
  "+6 this month": "+6 ce mois-ci",
  "Revenue trend": "Tendance des revenus",
  "Monthly performance": "Performance mensuelle",
  "AI recommendation": "Recommandation IA",
  "Protect the improving trend with a focused next action.":
    "Protégez la tendance à la hausse avec une action ciblée.",
  "Based on trend, target progress and prior outcomes.":
    "Fondé sur la tendance, la progression de la cible et les résultats précédents.",
  "Review recommendation": "Examiner la recommandation",
  "3 decisions need an outcome review": "3 décisions nécessitent une révision du résultat",
  "Decision queue": "File des décisions",
  "Outcome tracking included": "Suivi des résultats inclus",
  Connect: "Connecter",
  Analyze: "Analyser",
  Forecast: "Prévoir",
  Recommend: "Recommander",
  Decide: "Décider",
  "Bring in files, analytics, accounting, commerce, marketing, or database data.":
    "Importez des fichiers et des données d'analyse, de comptabilité, de commerce, de marketing ou de bases de données.",
  "Use business intelligence dashboards to see the measures, patterns and changes that matter.":
    "Utilisez des tableaux de bord de veille stratégique pour voir les mesures, tendances et changements importants.",
  "Understand what current signals may mean next.":
    "Comprenez ce que les signaux actuels pourraient annoncer.",
  "Turn evidence into a clear next action.":
    "Transformez les données probantes en prochaine action claire.",
  "Record the choice, owner, expected result and review date.":
    "Enregistrez le choix, le responsable, le résultat attendu et la date de révision.",
  "Capture outcomes and lessons for better future decisions.":
    "Enregistrez les résultats et les apprentissages pour de meilleures décisions futures.",
  "CSV / Excel / Systems": "CSV / Excel / Systèmes",
  "Analytics engine": "Moteur analytique",
  Recommendations: "Recommandations",
  "Decisions / Outcomes / Lessons": "Décisions / Résultats / Apprentissages",
  "Open the live demo for the": "Ouvrir la démo en direct du",
  "General Business": "Entreprise générale",
  "A practical view of growth, efficiency and operating health.":
    "Une vue pratique de la croissance, de l'efficacité et de la santé opérationnelle.",
  Marketing: "Marketing",
  "Connect campaign performance to pipeline and revenue decisions.":
    "Reliez la performance des campagnes aux décisions concernant le pipeline et les revenus.",
  Sales: "Ventes",
  "Track funnel movement, conversion and the decisions behind results.":
    "Suivez l'évolution de l'entonnoir, la conversion et les décisions derrière les résultats.",
  Retail: "Commerce de détail",
  "Find the product, channel and period signals shaping demand.":
    "Trouvez les signaux de produit, de canal et de période qui façonnent la demande.",
  Restaurant: "Restaurant",
  "Make clearer decisions about covers, sales, labor and margins.":
    "Prenez de meilleures décisions concernant les couverts, les ventes, la main-d'oeuvre et les marges.",
  "Hotels & Hospitality": "Hôtels et hôtellerie",
  "Connect occupancy, room revenue, booking channels and guest experience.":
    "Reliez l'occupation, les revenus des chambres, les canaux de réservation et l'expérience client.",
  "Professional Services": "Services professionnels",
  "Connect utilization, delivery, clients and commercial performance.":
    "Reliez l'utilisation, la prestation, les clients et la performance commerciale.",
  Healthcare: "Soins de santé",
  "Bring service demand, capacity, quality and follow-up into view.":
    "Mettez en évidence la demande de services, la capacité, la qualité et le suivi.",
  Construction: "Construction",
  "Connect project progress, costs, resources and delivery decisions.":
    "Reliez l'avancement des projets, les coûts, les ressources et les décisions de livraison.",
  "Law Firm": "Cabinet d'avocats",
  "Understand matter workload, realization, clients and team capacity.":
    "Comprenez la charge des dossiers, la réalisation, les clients et la capacité de l'équipe.",
  "Auto Repair Shop": "Atelier de réparation automobile",
  "Track repair orders, service mix, bay utilization and return visits.":
    "Suivez les ordres de réparation, le mix de services, l'utilisation des baies et les visites de retour.",
  "Sage Cloud Accounting": "Comptabilité Sage Cloud",
  "Zoho Books": "Zoho Books",
  "Learn": "Apprendre",
  Free: "Gratuit",
  Professional: "Professionnel",
  Agency: "Agence",
  "Decision intelligence for a business managing its own workspace.":
    "L'intelligence décisionnelle pour une entreprise qui gère son propre espace de travail.",
  "Manage an agency workspace and up to 10 client workspaces.":
    "Gérez un espace de travail d'agence et jusqu'à 10 espaces clients.",
  "5,000 AI credits/month or 60,000/year": "5 000 crédits IA/mois ou 60 000/an",
  "25,000 AI credits/month or 300,000/year": "25 000 crédits IA/mois ou 300 000/an",
  "What is Decisionate?": "Qu'est-ce que Decisionate ?",
  "How does decision intelligence work?": "Comment fonctionne l'intelligence décisionnelle ?",
  "Can I upload files?": "Puis-je téléverser des fichiers ?",
  "Which connectors are available?": "Quels connecteurs sont disponibles ?",
  "What can I do with the dashboards?": "Que puis-je faire avec les tableaux de bord ?",
  "Can I combine data from more than one dataset?": "Puis-je combiner des données de plusieurs jeux de données ?",
  "How do AI recommendations and forecasts work?": "Comment fonctionnent les recommandations et prévisions IA ?",
  "What are alerts used for?": "À quoi servent les alertes ?",
  "How does Decisionate learn from decisions?": "Comment Decisionate apprend-il des décisions ?",
  "Can I export decisions?": "Puis-je exporter les décisions ?",
  "How are workspaces and permissions organized?": "Comment les espaces de travail et les permissions sont-ils organisés ?",
  "Can an agency manage client workspaces?": "Une agence peut-elle gérer des espaces clients ?",
  "Is there a live demo?": "Existe-t-il une démo en direct ?",
  "What does the free trial include?": "Que comprend l'essai gratuit ?",
  "What are Decisionate AI credits?": "Que sont les crédits IA Decisionate ?",
  "Is my data secure?": "Mes données sont-elles sécurisées ?",
  "Decisionate is a decision intelligence platform for growing businesses and agencies. It connects business data to analysis, forecasts, recommendations, accountable decisions and outcome learning.":
    "Decisionate est une plateforme d'intelligence décisionnelle pour les entreprises et agences en croissance. Elle relie les données d'entreprise à l'analyse, aux prévisions, aux recommandations, aux décisions imputables et à l'apprentissage des résultats.",
  "Yes. CSV, Excel, JSON and Parquet files can be uploaded. The dataset schema comes from the incoming file, and you can choose the date, dimension and metric columns used for analysis.":
    "Oui. Les fichiers CSV, Excel, JSON et Parquet peuvent être téléversés. Le schéma du jeu de données provient du fichier entrant, et vous pouvez choisir les colonnes de date, de dimension et de métrique utilisées pour l'analyse.",
  "Yes. The live demo can be opened without signing in and uses prepared demonstration datasets. It is read-only: demo data cannot be uploaded or deleted, and creating decisions is disabled.":
    "Oui. La démo en direct peut être ouverte sans connexion et utilise des jeux de données préparés. Elle est en lecture seule : les données de démo ne peuvent pas être téléversées ou supprimées et la création de décisions est désactivée.",
  "How can I get help?": "Comment puis-je obtenir de l'aide ?",
  "Use Help & Support inside the application to contact support through the web form, report a bug, request a feature or review the product reference guide. Workspace, account, page and session context are attached automatically to support requests.":
    "Utilisez Aide et assistance dans l'application pour contacter le support via le formulaire, signaler un bogue, demander une fonctionnalité ou consulter le guide de référence. Le contexte de l'espace, du compte, de la page et de la session est joint automatiquement aux demandes.",
  "Pause demo": "Mettre la démo en pause",
  "Play demo": "Lire la démo",
  "Decisionate workflow": "Flux de travail Decisionate",
  step: "étape",
  Step: "Étape",
  of: "sur",
  "Do this": "À faire",
  "Get this": "Vous obtenez",
  "Connected sources": "Sources connectées",
  "Metric mapping": "Mappage des métriques",
  "Relationship analysis": "Analyse des relations",
  "Alert monitor": "Surveillance des alertes",
  "New decision": "Nouvelle décision",
  "Outcome review": "Révision du résultat",
  "Forecast evidence": "Données probantes de prévision",
  "Business performance": "Performance de l'entreprise",
  "Ready for analysis": "Prêt pour l'analyse",
  "Use the columns that answer the question": "Utilisez les colonnes qui répondent à la question",
  "Observed association, not proven causation": "Association observée, sans causalité prouvée",
  "Signals checked against recent patterns": "Signaux comparés aux tendances récentes",
  "Recommendation converted to action": "Recommandation convertie en action",
  "Evidence returned to the decision loop": "Données probantes réintégrées dans la boucle de décision",
  "Historical actuals compared with the forecast": "Résultats historiques comparés aux prévisions",
  "Last 7 periods": "7 dernières périodes",
  Actual: "Réel",
  Analytics: "Analytique",
  CRM: "CRM",
  Mapped: "Mappé",
  Connected: "Connecté",
  Detected: "Détecté",
  Aggregation: "Agrégation",
  "Monthly sum": "Somme mensuelle",
  "Meta Ads · Ad spend": "Meta Ads · Dépenses publicitaires",
  Input: "Entrée",
  "Revenue · Monthly sum": "Revenus · Somme mensuelle",
  "Best observed delay": "Meilleur décalage observé",
  "about 1 month": "environ 1 mois",
  "Unusual increase detected": "Hausse inhabituelle détectée",
  "24% above range": "24 % au-dessus de la plage",
  Expected: "Attendu",
  "Repeat the tested offer with the strongest channel mix.":
    "Répétez l'offre testée avec le meilleur mix de canaux.",
  "Alert signal": "Signal d'alerte",
  "Decision record": "Fiche de décision",
  "Learning evidence": "Données probantes d'apprentissage",
  "Relationship context": "Contexte de relation",
  "Dashboard signal": "Signal du tableau de bord",
  "Revenue is outside its recent expected range.": "Les revenus sont hors de leur plage récente attendue.",
  "Increase campaign focus for the next review period.": "Augmentez l'attention portée à la campagne pour la prochaine période de révision.",
  "Outcome recorded. Lesson added to future context.": "Résultat enregistré. Apprentissage ajouté au contexte futur.",
  "Ad spend and revenue move together with a one-month observed delay.": "Les dépenses publicitaires et les revenus évoluent ensemble avec un décalage observé d'un mois.",
  "Revenue is moving above its recent baseline.": "Les revenus dépassent leur référence récente.",
  Example: "Exemple",
  "Start again": "Recommencer",
  "Next step": "Étape suivante",
  "Demo progress": "Progression de la démo",
  "Jump to": "Aller à",
  "Restart demo": "Redémarrer la démo",
  "Revenue is up 18% since the previous period": "Les revenus ont augmenté de 18 % depuis la période précédente",
  "Focus the highest-converting channel": "Concentrez-vous sur le canal qui convertit le mieux",
  "Increase qualified leads by 12%": "Augmentez les prospects qualifiés de 12 %",
  "Review date": "Date de révision",
  "Jul 31, 2026": "31 juill. 2026",
  "Successful · Actual revenue: $12,400 · Lesson: repeat the tested offer": "Réussite · Revenus réels : 12 400 $ · Apprentissage : répéter l'offre testée",
  "Decisionate follows a connected workflow: bring in business data, analyze the signals, review a recommendation, create an owned decision, record the outcome and capture the lesson for future recommendations. Decisions remain accountable to your team; the platform supports the decision rather than taking unapproved action.":
    "Decisionate suit un flux de travail connecté : importez les données d'entreprise, analysez les signaux, examinez une recommandation, créez une décision attribuée, enregistrez le résultat et retenez l'apprentissage pour les recommandations futures. Les décisions restent sous la responsabilité de votre équipe ; la plateforme les accompagne sans prendre d'actions non approuvées.",
  "The current connector set includes Google Analytics, Google Ads, Google Business Profile, Google Search Console, PostgreSQL, MySQL, SQL Server, Stripe, Shopify, QuickBooks, FreshBooks, Xero, HubSpot, Meta Ads and Salesforce Sales Cloud. Salesforce Sales Cloud currently supports Accounts, Leads and Opportunities. Connector credentials and provider setup are managed before a workspace runs its first sync.":
    "Les connecteurs actuels comprennent Google Analytics, Google Ads, Google Business Profile, Google Search Console, PostgreSQL, MySQL, SQL Server, Stripe, Shopify, QuickBooks, FreshBooks, Xero, HubSpot, Meta Ads et Salesforce Sales Cloud. Salesforce Sales Cloud prend actuellement en charge les comptes, prospects et opportunités. Les identifiants et la configuration des fournisseurs sont gérés avant la première synchronisation d'un espace de travail.",
  "Dashboards provide business intelligence views for performance analysis, including general business, decision, sales, marketing and industry-specific views. You can select datasets and metrics, set date periods, aggregate by day, week, month or quarter, use sum, count, average, minimum or maximum, and compare relevant metrics.":
    "Les tableaux de bord offrent des vues de veille stratégique pour analyser la performance, notamment des vues générales, décisionnelles, commerciales, marketing et sectorielles. Vous pouvez sélectionner des jeux de données et des métriques, définir des périodes, agréger par jour, semaine, mois ou trimestre, utiliser la somme, le décompte, la moyenne, le minimum ou le maximum, et comparer les métriques pertinentes.",
  "Yes. Datasets can be joined on normalized time periods, and related metrics can be analyzed together. The resulting data remains scoped to the active workspace and can support dashboard analysis and decisions.":
    "Oui. Les jeux de données peuvent être joints sur des périodes normalisées et les métriques liées peuvent être analysées ensemble. Les données résultantes restent limitées à l'espace de travail actif et peuvent alimenter l'analyse des tableaux de bord et les décisions.",
  "When AI is configured, Decisionate provides recommendations using bounded analytical summaries, selected metrics and relevant historical decision outcomes. Forecasts use the selected time series and aggregation settings. Recommendations and forecasts are evidence to review, not guarantees or proof of causation.":
    "Lorsque l'IA est configurée, Decisionate fournit des recommandations à partir de résumés analytiques encadrés, de métriques sélectionnées et de résultats historiques pertinents. Les prévisions utilisent la série temporelle et les paramètres d'agrégation sélectionnés. Les recommandations et prévisions sont des données probantes à examiner, pas des garanties ni des preuves de causalité.",
  "Workspace owners can configure alerts around selected datasets, metrics and optional KPI targets. Alerts can identify meaningful changes and deliver reports or recommendations by email on the configured schedule. Alert data and recipients are isolated by workspace.":
    "Les propriétaires d'espaces de travail peuvent configurer des alertes autour de jeux de données, métriques et cibles d'indicateurs sélectionnés. Les alertes peuvent détecter des changements importants et envoyer des rapports ou recommandations par courriel selon l'horaire configuré. Les données et destinataires des alertes sont isolés par espace de travail.",
  "Each decision can include an owner, action, expected outcome, review details, actual outcome, status and lesson learned. That history becomes bounded evidence that can inform later recommendations while remaining subject to human review.":
    "Chaque décision peut inclure un responsable, une action, un résultat attendu, des détails de révision, le résultat réel, un statut et un apprentissage. Cet historique devient une donnée probante encadrée pouvant éclairer les recommandations ultérieures, tout en restant soumise à l'examen humain.",
  "The workspace owner can export the current decision results as CSV for analysis or JSON for complete structured records, including ownership, timestamps, outcomes, notes, lessons and activity history. Export activity is logged. Connector source data is not offered as a separate data export.":
    "Le propriétaire de l'espace de travail peut exporter les résultats actuels des décisions en CSV pour l'analyse ou en JSON pour obtenir les enregistrements structurés complets, y compris les responsables, horodatages, résultats, notes, apprentissages et historique d'activité. Les exportations sont journalisées. Les données sources des connecteurs ne sont pas proposées comme export séparé.",
  "Each workspace is isolated. Professional workspaces support an owner and members. Agency workspaces can manage client workspaces, with agency branding and separate client access. Owners control settings, members, connections and other management actions according to the workspace role model.":
    "Chaque espace de travail est isolé. Les espaces Professionnel prennent en charge un propriétaire et des membres. Les espaces d'agence peuvent gérer des espaces clients, avec l'image de marque de l'agence et des accès clients séparés. Les propriétaires contrôlent les paramètres, membres, connexions et autres actions de gestion selon le modèle de rôles de l'espace.",
  "Yes. Agency plans include an agency workspace and client workspaces. Agency owners can create and manage client access, while client users work within their own client workspace and see the access permitted by their role.":
    "Oui. Les plans d'agence comprennent un espace d'agence et des espaces clients. Les propriétaires d'agence peuvent créer et gérer les accès clients, tandis que les utilisateurs clients travaillent dans leur propre espace et voient les accès autorisés par leur rôle.",
  "The 30-day free trial provides the full Professional or Agency feature set, with the plan's included AI credits, and no credit card is required. Professional trials include 1 workspace, while Agency trials include 10 client workspaces. Professional includes 5,000 AI credits/month or 60,000/year and costs $79 CAD/month or $790 CAD/year. Agency includes 25,000 AI credits/month or 300,000/year and costs $199 CAD/month or $1,990 CAD/year. Additional client workspaces are $20 CAD/month or $200 CAD/year each.":
    "L'essai gratuit de 30 jours offre toutes les fonctionnalités Professionnel ou Agence, avec les crédits IA inclus dans le plan, sans carte de crédit. Les essais Professionnel comprennent 1 espace de travail, tandis que les essais Agence comprennent 10 espaces clients. Professionnel comprend 5 000 crédits IA/mois ou 60 000/an et coûte 79 CAD/mois ou 790 CAD/an. Agence comprend 25 000 crédits IA/mois ou 300 000/an et coûte 199 CAD/mois ou 1 990 CAD/an. Les espaces clients supplémentaires coûtent 20 CAD/mois ou 200 CAD/an chacun.",
  "Decisionate AI credits are an application usage allowance, not OpenAI credits or currency. The default monthly allocations are 1,000 for Free, 5,000 for Professional and 25,000 for Agency. Free has no annual allocation; Professional and Agency annual allocations are twelve times their monthly amounts: 60,000 and 300,000. Each additional client workspace includes 2,500 AI credits/month or 30,000/year. Allocations can be adjusted by the platform administrator as usage and provider costs change.":
    "Les crédits IA Decisionate sont une allocation d'utilisation de l'application, et non des crédits OpenAI ou une monnaie. Les allocations mensuelles par défaut sont de 1 000 pour Gratuit, 5 000 pour Professionnel et 25 000 pour Agence. Gratuit n'a pas d'allocation annuelle ; les allocations annuelles de Professionnel et Agence correspondent à douze fois leurs montants mensuels : 60 000 et 300 000. Chaque espace client supplémentaire comprend 2 500 crédits IA/mois ou 30 000/an. Les allocations peuvent être ajustées par l'administrateur de la plateforme selon l'utilisation et les coûts des fournisseurs.",
  "Workspace access is isolated, management actions are role-protected, connector credentials are handled separately from workspace data, and shared dashboards use controlled links. Review the Security, Privacy and Terms pages for the current controls, processors, AI data handling, retention and deletion commitments.":
    "L'accès aux espaces de travail est isolé, les actions de gestion sont protégées par rôle, les identifiants des connecteurs sont traités séparément des données de l'espace et les tableaux de bord partagés utilisent des liens contrôlés. Consultez les pages Sécurité, Confidentialité et Conditions pour connaître les contrôles, sous-traitants, traitements IA, engagements de conservation et de suppression actuels.",
  "Start with one workspace and a practical monthly AI allowance.": "Commencez avec un espace de travail et une allocation mensuelle pratique de crédits IA.",
  "Upload a CSV or Excel file, or connect a source your team already uses.": "Téléversez un fichier CSV ou Excel, ou connectez une source déjà utilisée par votre équipe.",
  "Choose a source and bring a dataset into the workspace.": "Choisissez une source et importez un jeu de données dans l'espace de travail.",
  "A shared, analyzable dataset with its columns and time range ready to inspect.": "Un jeu de données partagé et analysable, avec ses colonnes et sa période prêts à être examinés.",
  "Example: Google Analytics marketing data": "Exemple : données marketing Google Analytics",
  "Tell Decisionate what matters": "Indiquez à Decisionate ce qui compte",
  "Select the dataset, metrics, date range, aggregation and dashboard that frame the question.": "Sélectionnez le jeu de données, les métriques, la période, l'agrégation et le tableau de bord qui cadrent la question.",
  "Map a business metric to a source column and set the analysis period.": "Associez une métrique d'entreprise à une colonne source et définissez la période d'analyse.",
  "Every KPI and chart uses the same metric, period and aggregation choices.": "Chaque indicateur et graphique utilise les mêmes choix de métrique, de période et d'agrégation.",
  "Revenue → revenue · Jan 1–Jun 30 · Monthly sum": "Revenus → revenue · 1 janv.–30 juin · Somme mensuelle",
  "Connect the signals behind a decision": "Reliez les signaux derrière une décision",
  "Relate metrics from separate sources by normalized periods when one dataset does not tell the whole story.": "Reliez les métriques de sources distinctes par périodes normalisées lorsqu'un seul jeu de données ne raconte pas toute l'histoire.",
  "Compare marketing spend with revenue and let Decisionate test sensible timing automatically.": "Comparez les dépenses marketing aux revenus et laissez Decisionate tester automatiquement des décalages pertinents.",
  "A business-friendly association with strength, matched periods and the observed delay.": "Une association compréhensible pour l'entreprise, avec sa force, ses périodes correspondantes et le décalage observé.",
  "Strong association · Revenue follows ad spend by about 1 month": "Association forte · Les revenus suivent les dépenses publicitaires d'environ 1 mois",
  "Keep important changes in view": "Gardez les changements importants en vue",
  "Anomaly detection, targets and scheduled alerts help surface meaningful changes without requiring someone to watch every chart.": "La détection d'anomalies, les cibles et les alertes planifiées font ressortir les changements importants sans obliger quelqu'un à surveiller chaque graphique.",
  "Choose a metric, define an optional target and configure an alert delivery channel.": "Choisissez une métrique, définissez une cible facultative et configurez un canal de diffusion des alertes.",
  "A concise signal with the evidence, recommendation and next step ready for review.": "Un signal concis avec les données probantes, la recommandation et la prochaine étape prêts à être examinés.",
  "Unusual increase · Revenue is 24% above its recent expected range": "Hausse inhabituelle · Les revenus sont 24 % au-dessus de leur plage récente attendue",
  "See the signal behind the numbers": "Voyez le signal derrière les chiffres",
  "Use dashboards, KPIs, comparisons and category breakdowns to understand what changed.": "Utilisez les tableaux de bord, indicateurs, comparaisons et ventilations par catégorie pour comprendre ce qui a changé.",
  "Compare performance and look for a meaningful movement before acting.": "Comparez la performance et cherchez un mouvement significatif avant d'agir.",
  "A focused view of the evidence behind the business question.": "Une vue ciblée des données probantes derrière la question d'entreprise.",
  "Turn evidence into a next action": "Transformez les données probantes en prochaine action",
  "Forecasts and recommendations combine current signals with historical decision learning, with transparent fallback guidance when AI is unavailable.": "Les prévisions et recommandations combinent les signaux actuels à l'apprentissage historique des décisions, avec des indications de repli transparentes lorsque l'IA n'est pas disponible.",
  "Review the forecast, confidence, risks and supporting evidence.": "Examinez la prévision, le niveau de confiance, les risques et les données probantes à l'appui.",
  "A recommendation you can review and convert into a decision with its evidence preserved.": "Une recommandation que vous pouvez examiner et convertir en décision tout en conservant ses données probantes.",
  "Make the choice accountable": "Rendez le choix imputable",
  "Convert a recommendation into a decision with an owner, expected outcome and review date.": "Convertissez une recommandation en décision avec un responsable, un résultat attendu et une date de révision.",
  "Record what will be done, the expected outcome and how success will be measured.": "Enregistrez ce qui sera fait, le résultat attendu et la façon dont le succès sera mesuré.",
  "A decision record that can be reviewed instead of disappearing into a chat or meeting.": "Une fiche de décision qui peut être examinée au lieu de disparaître dans une conversation ou une réunion.",
  "Make the next recommendation wiser": "Rendez la prochaine recommandation plus pertinente",
  "Record the actual result, outcome status and lesson learned when the decision is reviewed.": "Enregistrez le résultat réel, le statut du résultat et l'apprentissage lors de la révision de la décision.",
  "Compare the expected outcome with what happened and capture the lesson.": "Comparez le résultat attendu à ce qui s'est passé et retenez l'apprentissage.",
  "Future recommendations can use your workspace's own decision evidence.": "Les recommandations futures peuvent utiliser les propres données probantes décisionnelles de votre espace.",
}

export type DecisionateTranslationKey =
  keyof typeof translations.en

export function getCurrentDecisionateLanguage(): DecisionateLanguage {
  if (typeof document === "undefined") {
    return "en"
  }

  return document.documentElement.lang
    .toLowerCase()
    .startsWith("fr")
    ? "fr"
    : "en"
}

export function applyDecisionateLanguage(
  language: DecisionateLanguage
) {
  if (typeof document === "undefined") {
    return
  }

  document.documentElement.lang =
    languageLocales[language]

  try {
    window.localStorage.setItem(
      decisionateLanguageStorageKey,
      language
    )
  } catch {
    // Storage can be unavailable in strict privacy contexts.
  }

  window.dispatchEvent(
    new CustomEvent<DecisionateLanguageChange>(
      decisionateLanguageChangedEvent,
      {
        detail: { language },
      }
    )
  )
}

export function toggleDecisionateLanguage(
  currentLanguage = getCurrentDecisionateLanguage()
) {
  const nextLanguage =
    currentLanguage === "fr" ? "en" : "fr"

  applyDecisionateLanguage(nextLanguage)

  return nextLanguage
}

export function getDecisionateText(
  language: DecisionateLanguage,
  key: DecisionateTranslationKey
) {
  return translations[language][key]
}

export function getLandingText(
  language: DecisionateLanguage,
  source: string
) {
  return language === "fr"
    ? frenchLandingTranslations[source] ?? source
    : source
}

export function getServerDecisionateLanguage(): DecisionateLanguage {
  return "en"
}
