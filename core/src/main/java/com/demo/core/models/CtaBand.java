package com.demo.core.models;

import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class CtaBand {

    @ValueMapValue private String eyebrow;
    @ValueMapValue private String headline;
    @ValueMapValue private String subhead;
    @ValueMapValue private String ctaLabel;
    @ValueMapValue private String ctaHref;
    @ValueMapValue private String secondaryLabel;
    @ValueMapValue private String secondaryHref;

    public String getEyebrow() { return eyebrow; }
    public String getHeadline() { return headline; }
    public String getSubhead() { return subhead; }
    public String getCtaLabel() { return ctaLabel; }
    public String getCtaHref() { return ctaHref; }
    public String getSecondaryLabel() { return secondaryLabel; }
    public String getSecondaryHref() { return secondaryHref; }

    public boolean isHasContent() { return headline != null && !headline.trim().isEmpty(); }
}
