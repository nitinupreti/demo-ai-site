package com.demo.core.models.totc;

import org.apache.commons.lang3.StringUtils;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.Default;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class SectionTitleModel {

    @ValueMapValue private String eyebrow;
    @ValueMapValue private String title;
    @ValueMapValue private String subtitle;

    @ValueMapValue @Default(values = "center") private String align;
    @ValueMapValue @Default(values = "navy")   private String titleColor;
    @ValueMapValue @Default(values = "lg")     private String padTop;
    @ValueMapValue @Default(values = "md")     private String padBottom;

    public String getEyebrow() { return eyebrow; }
    public String getTitle() { return title; }
    public String getSubtitle() { return subtitle; }
    public String getAlign() { return align; }
    public String getTitleColor() { return titleColor; }
    public String getPadTop() { return padTop; }
    public String getPadBottom() { return padBottom; }

    public boolean isHasContent() {
        return StringUtils.isNotBlank(eyebrow)
                || StringUtils.isNotBlank(title)
                || StringUtils.isNotBlank(subtitle);
    }
}
