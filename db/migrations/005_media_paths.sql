-- Store public media URLs consistently for both imported and uploaded files.
UPDATE media SET path='/media/' || path WHERE path NOT LIKE '/media/%';
UPDATE products SET image_path='/media/' || image_path WHERE image_path IS NOT NULL AND image_path NOT LIKE '/media/%';
ALTER TABLE media ADD CONSTRAINT media_public_path CHECK(path LIKE '/media/%');
ALTER TABLE products ADD CONSTRAINT product_public_image CHECK(image_path IS NULL OR image_path LIKE '/media/%');
