export default function LabSampleLabel({ test = {}, patientRecord = {}, sampleBarcode = '', patientNumber = '', collectionStamp = '' }) {
  return (
    <div className="page">
      <div className="label">
        <div className="top">
          <div className="name">{patientRecord.full_name || test.patient_name || 'Patient'}</div>
          <div>{patientNumber || patientRecord.patient_number || ''}</div>
        </div>
        <div className="meta">{test.test_type || test.test_name || 'Laboratory sample'} · {test.sample_type || test.category || 'Specimen'}</div>
        <div className="barcode-wrap"><svg id="sample-barcode" aria-label={`Barcode ${sampleBarcode}`} /></div>
        <div className="code">{sampleBarcode}</div>
        <div className="meta">{collectionStamp}</div>
      </div>
    </div>
  )
}