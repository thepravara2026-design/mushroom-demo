// lightweight helpers for admin training UI (kept separate for clarity)
export function renderTrainingCard(t) {
  return `
    <div class="admin-training-row" data-id="${t.id}">
      <div style="display:flex;gap:12px;align-items:center;">
        <img src="${t.image_url || '/images/training_farm.png'}" alt="${t.title}" style="width:64px;height:64px;object-fit:cover;border-radius:8px;">
        <div>
          <strong>${t.title}</strong>
          <div style="font-size:0.9rem;color:#475569">${t.category} · ${t.description || ''}</div>
        </div>
      </div>
      <div class="admin-row-actions">
        <button class="btn-admin-edit" onclick="window.adminEditTraining('${t.id}')"><i class="fa-solid fa-pen"></i> Edit</button>
        <button class="btn-admin-delete" onclick="window.adminDeleteTraining('${t.id}')"><i class="fa-solid fa-trash"></i></button>
      </div>
    </div>
  `;
}
