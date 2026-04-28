export const DB_OPERATION_SQL = {
  hardwareMetricsList: "SELECT * FROM hardware_metric ORDER BY ts ASC",

  datasetsListFiles: "SELECT dataset, uploadedAt, mime, name, key, dead FROM file",
  datasetsListNames: "SELECT dataset FROM file GROUP BY dataset;",
  datasetCheckExists: "SELECT id FROM file WHERE dataset = $dataset LIMIT 1",
  datasetCreateFile: "CREATE file SET name = $name, key = $key, bucket = $bucket, size = $size, mime = $mime, dataset = $dataset, encode = $encode, uploadedAt = time::now(), thumbKey = $thumbKey",
  datasetFilesByName: "SELECT * FROM file WHERE dataset == $dataset ORDER BY name ASC",
  datasetSoftDelete: "UPDATE file SET dead = true WHERE dataset = $dataset",
  datasetNavFiles: "SELECT id, name, key, bucket, dead FROM file WHERE dataset == $dataset ORDER BY name ASC",
  fileById: "SELECT * FROM file WHERE id == <record> $id LIMIT 1;",
  fileSoftDeleteById: "UPDATE file SET dead = true WHERE id = <record> $id",
  fileSoftDeleteByDatasetKey: "UPDATE file SET dead = true WHERE dataset = $dataset AND key = $key",

  mergeGroupDeleteAll: "DELETE merge_group WHERE dataset == $dataset AND mode == 'all'",
  mergeGroupCreateAll: "CREATE merge_group CONTENT { dataset: $dataset, mode: 'all', members: $members, createdAt: time::now() }",
  mergeGroupGetAll: "SELECT * FROM merge_group WHERE dataset == $dataset AND mode == 'all' LIMIT 1",
  hlsJobsByDataset: "SELECT file, status, created_at FROM hls_job WHERE file.dataset == $dataset ORDER BY created_at DESC",
  hlsPlaylistByFile: "SELECT * FROM hls_playlist WHERE file = <record> $id LIMIT 1;",

  labelNamesByDataset: "SELECT name FROM label WHERE dataset == $dataset",
  labelsByDataset: "SELECT * FROM label WHERE dataset == $dataset ORDER BY name ASC",
  labelCreate: "CREATE label CONTENT { dataset: $dataset, name: $name }",
  labelDelete: "DELETE label WHERE dataset == $dataset AND name == $name",

  annotationPresenceByDataset: "SELECT file, array::distinct(category) AS cats FROM annotation WHERE dataset == $dataset GROUP BY file",
  annotationsImageByFile: "SELECT * FROM annotation WHERE file == <record> $fid AND (category = 'image_bbox' OR category = NONE)",
  annotationsVideoByFile: "SELECT * FROM annotation WHERE file == <record> $fid AND category = 'sam2_key_bbox'",
  annotationTextByFile: "SELECT * FROM annotation WHERE file == <record> $fid AND category = 'text_label' LIMIT 1",
  annotationCreateBox: "CREATE annotation CONTENT { dataset: $dataset, file: <record> $file, label: $label, category: $category, x1: $x1, y1: $y1, x2: $x2, y2: $y2 }",
  annotationCreateText: "CREATE annotation CONTENT { dataset: $dataset, file: <record> $file, category: 'text_label', text: $text }",
  annotationUpdateText: "UPDATE annotation SET text = $text WHERE id = <record> $id",
  annotationDeleteById: "DELETE annotation WHERE id = <record> $id",
  annotationDeleteByDatasetLabel: "DELETE annotation WHERE dataset == $dataset AND label == $name",
  inferenceJobsList: "SELECT * FROM inference_job ORDER BY updatedAt DESC",
  inferenceJobByName: "SELECT * FROM inference_job WHERE name == $name ORDER BY updatedAt DESC LIMIT 1",
  inferenceJobProgressByName: "SELECT progress FROM inference_job WHERE name == $name LIMIT 1",
  inferenceJobCheckByName: "SELECT id, dead FROM inference_job WHERE name == $name LIMIT 1",
  inferenceJobCreate: "CREATE inference_job CONTENT { name: $name, dead: false, status: 'ProcessWaiting', taskType: $taskType, model: $model, modelSource: $modelSource, datasets: $datasets, createdAt: time::now(), updatedAt: time::now() }",
  inferenceJobUpdate: "UPDATE inference_job SET dead = false, status = 'ProcessWaiting', taskType = $taskType, model = $model, modelSource = $modelSource, datasets = $datasets, updatedAt = time::now() WHERE name == $name",
  inferenceJobSoftDelete: "UPDATE inference_job SET dead = true, updatedAt = time::now() WHERE name == $name",
  inferenceJobStop: "UPDATE inference_job SET status = 'StopInterrept', updatedAt = time::now() WHERE name == $name",
  inferenceJobCopy: "CREATE inference_job SET name = $name, status = 'ProcessWaiting', taskType = $taskType, model = $model, modelSource = $modelSource, datasets = $datasets, createdAt = time::now(), updatedAt = time::now()",
  inferenceResultsByJob: "SELECT * FROM inference_result WHERE job == <record> $job ORDER BY createdAt DESC",

  completedTrainingJobs: "SELECT name FROM training_job WHERE status IN ['Complete', 'Completed']",
  trainingJobsList: "SELECT * FROM training_job ORDER BY updatedAt DESC",
  trainingJobByName: "SELECT * FROM training_job WHERE name == $name ORDER BY updatedAt DESC LIMIT 1",
  trainingJobCheckByName: "SELECT id FROM training_job WHERE name == $name LIMIT 1",
  trainingJobCreate: "CREATE training_job CONTENT { name: $name, status: 'ProcessWaiting', taskType: $taskType, model: $model, datasets: $datasets, labels: $labels, epochs: $epochs, batchSize: $batchSize, splitTrain: $splitTrain, splitTest: $splitTest, createdAt: time::now(), updatedAt: time::now() }",
  trainingJobUpdate: "UPDATE training_job SET status = 'ProcessWaiting', taskType = $taskType, model = $model, datasets = $datasets, labels = $labels, epochs = $epochs, batchSize = $batchSize, splitTrain = $splitTrain, splitTest = $splitTest, updatedAt = time::now() WHERE name == $name",
  trainingJobDelete: "DELETE training_job WHERE name == $name",
  trainingJobStop: "UPDATE training_job SET status = 'StopInterrept', updatedAt = time::now() WHERE name == $name",
} as const;

export type DbOperation = keyof typeof DB_OPERATION_SQL;

const SQL_TO_OPERATION = new Map<string, DbOperation>(
  Object.entries(DB_OPERATION_SQL).map(([operation, sql]) => [
    normalizeDbSql(sql),
    operation as DbOperation,
  ]),
);

export function normalizeDbSql(sql: string): string {
  return sql.trim().replace(/\s+/g, " ");
}

export function resolveDbOperation(sql: string): DbOperation | undefined {
  return SQL_TO_OPERATION.get(normalizeDbSql(sql));
}

export function isDbOperation(value: string): value is DbOperation {
  return Object.prototype.hasOwnProperty.call(DB_OPERATION_SQL, value);
}
