const categoryService = require('./src/services/categoryService');
const categoryRepo = require('./src/repositories/categoryRepository');

(async () => {
  try {
    console.log(
      'Before categories:',
      (await categoryRepo.findAll()).data.map((c) => c.id),
    );
    const created = await categoryService.createCategory({
      id: 'tmp-cat',
      name: 'Tmp',
      category_id: 'spore-999998',
    });
    console.log('Created:', created);
    console.log(
      'After create:',
      (await categoryRepo.findAll()).data.map((c) => c.id),
    );
    const res = await categoryRepo.findById('tmp-cat');
    console.log('findById:', res);
    const del = await categoryService.deleteCategory('tmp-cat');
    console.log('Deleted:', del);
    console.log(
      'After delete:',
      (await categoryRepo.findAll()).data.map((c) => c.id),
    );
  } catch (e) {
    console.error('ERROR', e && e.message, e);
  }
})();
