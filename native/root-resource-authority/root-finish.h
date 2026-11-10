/* Negative settlement of a known original consumed resource. TS still has to
 * prove its original SDK/Host/VM physical fate before invoking this function.
 * This Native boundary authenticates the same session/cap and SQL lineage. */
static napi_value finish_original_root(napi_env env,napi_callback_info info){
    napi_value args[3],out,record_out;
    if(!arguments(env,info,2,args))return fail(env,"ROOT_RESOURCE_ARGUMENT_INVALID");
    nr_session *s=session(env,args[0],0);
    if(!s)return NULL;
    nr_child *reservation=nr_get_child(env,args[1],s,NR_RESERVATION);
    if(!reservation)return fail(env,"ROOT_RESOURCE_RESERVATION_REQUIRED");
    out=object(env);record_out=object(env);
    if(!out||!record_out)return nr_error(env,s,"ROOT_RESOURCE_FINISH_UNCONFIRMED",0,0,0);
    nr_record record={0};
    nr_cell old[NR_MAX_CELLS]={0},next[NR_MAX_CELLS]={0},receipt[NR_MAX_CELLS]={0};
    int began=nr_begin(s),committed=0,history=0,known=0;
    const char *error="ROOT_RESOURCE_FINISH_UNCONFIRMED";
    if(!began||!floor_valid(s)||nr_read(s,reservation->record.key,&record)!=1||!nr_binding(&reservation->record,&record))goto bad;
    char launch[1600],json[1600];
    int n=snprintf(launch,sizeof(launch),"{\"acquireGeneration\":1,\"attemptId\":\"%s\",\"claimToken\":\"%s\",\"issuerEpoch\":1,\"metadataDigest\":\"%s\",\"recordId\":\"%s\"}",record.attempt,record.claim,record.digest,record.id);
    if(n<0||(size_t)n>=sizeof(launch))goto bad;
    int consumed=nr_exact_receipt(s,&record,"launch_consumed",launch);
    if(consumed<0)goto bad;
    if(!consumed||record.outbox!=1||!reservation->receipt_ref){known=1;error="ROOT_RESOURCE_NOT_CONSUMED";goto bad;}
    n=snprintf(json,sizeof(json),"{\"acquireGeneration\":1,\"attemptId\":\"%s\",\"claimToken\":\"%s\",\"issuerEpoch\":1,\"metadataDigest\":\"%s\",\"recordId\":\"%s\",\"state\":\"released\"}",record.attempt,record.claim,record.digest,record.id);
    if(n<0||(size_t)n>=sizeof(json))goto bad;
    if(!strcmp(record.state,"released")){
        if(nr_exact_receipt(s,&record,"physical_finished",json)!=1)goto bad;
        history=1;
    }else{
        if(!nr_active(record.state)||record.revision==NR_MAX_SAFE||!nr_record_cells(&record,old)||!nr_clone(next,old,11))goto bad;
        next[5].integer++;nr_cell_clear(next+8);
        if(!nr_text(next+8,"released")||!nr_receipt_cells(receipt,&record,"physical_finished",json))goto bad;
        nr_write *r=nr_expect(s,NR_RESOURCES,NR_UPDATE,old,next);
        nr_write *fact=r?nr_expect(s,NR_RECEIPTS,NR_INSERT,NULL,receipt):NULL;
        if(!fact||!nr_run_write(s,r)||!nr_run_write(s,fact))goto bad;
        nr_record_clear(&record);
        if(nr_read(s,reservation->record.key,&record)!=1)goto bad;
    }
    if(!nr_commit(s))goto bad;
    committed=1;nr_clear_frame(s);
    if(!nr_projection(env,record_out,&record)||!own_data(env,out,"record",record_out)||!boolean(env,out,"newlyFinished",!history)||!nr_local_current(s))goto bad;
    nr_record_clear(&record);nr_cells_clear(old,NR_MAX_CELLS);nr_cells_clear(next,NR_MAX_CELLS);nr_cells_clear(receipt,NR_MAX_CELLS);return out;
bad:
    nr_record_clear(&record);nr_cells_clear(old,NR_MAX_CELLS);nr_cells_clear(next,NR_MAX_CELLS);nr_cells_clear(receipt,NR_MAX_CELLS);
    return known&&!committed?nr_known_rejection(env,s,error,began):nr_abort(env,s,error,began,committed);
}
