// This temporary CI evidence step is never a normal-code qualification run.
const naturalEvent=process.env.GITHUB_EVENT_NAME==='push'||process.env.GITHUB_EVENT_NAME==='pull_request';
if(process.env.XIAOK_LOOP_READ_ERROR_DIAGNOSTIC!=='1'||process.env.GITHUB_ACTIONS!=='true'||process.env.GITHUB_RUN_ATTEMPT!=='1'||!naturalEvent){
 throw Error('loop_read_error_diagnostic_first_attempt_required');
}
