/** The gateway may have accepted a paid job. Never refund/re-submit on transport uncertainty. */
export class VideoSubmissionUncertainError extends Error {
  constructor(message = '视频提交结果待确认，请保留当前任务，勿重复生成') {
    super(message);
    this.name = 'VideoSubmissionUncertainError';
  }
}
